package com.dawntick.app.system;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.dawntick.app.diag.NativeLog;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * 系统级动作：用系统浏览器打开外部链接、跳到电池优化白名单申请页、读通知状态。
 * 外部链接不走 window.open：WebView 那条路在 Android 11+ 会先卡在包可见性判断上，表现为「打开失败」。
 *
 * 契约（插件名、方法名、返回字段）见 apps/web/src/lib/plugins.ts 与 apps/mobile/docs/plugins.contract.md。
 */
@CapacitorPlugin(name = "SystemActions")
public class SystemActionsPlugin extends Plugin {

    /** 原生诊断日志标签，与 diag/native.log 里的 `[tag]` 对应。 */
    private static final String TAG = "SystemActions";
    /** 课前提醒走本地通知插件创建的渠道；静音判断按这个渠道看。 */
    private static final String NOTIFY_CHANNEL_ID = "default";
    /** readNativeLog 未传 maxBytes 时的默认读取量（与 NativeLog 默认值一致）。 */
    private static final int DEFAULT_LOG_BYTES = 256 * 1024;

    /** 用 ACTION_VIEW 交给系统浏览器；失败时把异常类名与原 message 一起交回 Web 层。 */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String raw = call.getString("url");
        NativeLog.info(
                getContext(),
                TAG,
                "openExternal 入口 url=" + NativeLog.redactUrl(raw) + " length=" + (raw == null ? 0 : raw.length())
        );
        if (raw == null || raw.trim().isEmpty()) {
            NativeLog.warn(getContext(), TAG, "openExternal 缺少链接地址");
            call.reject("缺少链接地址");
            return;
        }
        String trimmed = raw.trim();
        Uri uri = Uri.parse(trimmed);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            NativeLog.warn(
                    getContext(),
                    TAG,
                    "openExternal scheme 不受支持 scheme=" + (scheme.isEmpty() ? "(无)" : scheme)
                            + " url=" + NativeLog.redactUrl(trimmed)
            );
            call.reject("只支持 http 与 https 链接");
            return;
        }
        NativeLog.info(getContext(), TAG, "openExternal scheme 校验通过 scheme=" + scheme + " host=" + uri.getHost());
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            NativeLog.info(getContext(), TAG, "openExternal startActivity 成功");
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            // 不再只报「没有可打开的应用」：把异常类名 + message 原样给界面，避免用户只看到「没反应」
            NativeLog.error(getContext(), TAG, "openExternal startActivity 失败", error);
            call.reject(NativeLog.describe(error));
        }
    }

    /**
     * 读原生诊断日志（`filesDir/diag/native.log`）最近的行，供设置页「导出诊断」使用。
     * 返回 `text`（最多 200 行）、`path`（日志绝对路径）与 `bytes`（本次返回文本的 UTF-8 字节数）。
     */
    @PluginMethod
    public void readNativeLog(PluginCall call) {
        Integer requested = call.getInt("maxBytes");
        int maxBytes = requested == null ? DEFAULT_LOG_BYTES : requested;
        String text = NativeLog.read(getContext(), maxBytes);
        JSObject result = new JSObject();
        result.put("text", text);
        result.put("path", NativeLog.logFile(getContext()).getAbsolutePath());
        result.put("bytes", text.getBytes(StandardCharsets.UTF_8).length);
        call.resolve(result);
    }

    /** 清空原生诊断日志（当前文件与滚动文件）；成功时 `cleared` 为 true。 */
    @PluginMethod
    public void clearNativeLog(PluginCall call) {
        NativeLog.clear(getContext());
        NativeLog.info(getContext(), TAG, "原生诊断日志已清空");
        call.resolve(new JSObject().put("cleared", true));
    }

    /**
     * 设备支持的 ABI：`Build.SUPPORTED_ABIS` 按系统优先级原序返回，`primary` 取第一个。
     * 更新下载据此在 arm64-v8a / armeabi-v7a 两个 APK 之间选择；旧安装包没有本方法时
     * Web 层会把调用失败按 arm64-v8a 处理，不阻塞更新检查。
     */
    @PluginMethod
    public void abi(PluginCall call) {
        String[] supported = Build.SUPPORTED_ABIS == null ? new String[0] : Build.SUPPORTED_ABIS;
        JSObject result = new JSObject();
        result.put("primary", supported.length == 0 ? "" : supported[0]);
        result.put("abis", new JSArray(Arrays.asList(supported)));
        call.resolve(result);
    }

    /** 是否已在电池优化白名单里（false 表示后台可能被系统掐掉，提醒会晚）。 */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        call.resolve(new JSObject().put("ignoring", ignoringBatteryOptimizations(getContext())));
    }

    /** 跳系统页申请加入电池优化白名单。 */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (ignoringBatteryOptimizations(getContext())) {
            call.resolve(new JSObject().put("ignoring", true));
            return;
        }
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("requested", true));
        } catch (ActivityNotFoundException error) {
            call.reject("打不开电池优化设置页", error);
        }
    }

    /**
     * 通知状态：应用级开关、Android 13+ 运行时权限、通知渠道是否被静音分开报。
     * asked 由界面传入：没申请过时「拒绝」与「永久拒绝」在系统里长得一样，只能靠自己记。
     */
    @PluginMethod
    public void notificationStatus(PluginCall call) {
        boolean asked = Boolean.TRUE.equals(call.getBoolean("asked", false));
        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean appEnabled = manager != null && manager.areNotificationsEnabled();

        String runtime;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                runtime = "granted";
            } else if (!asked) {
                runtime = "prompt";
            } else if (shouldShowRationale()) {
                runtime = "denied";
            } else {
                runtime = "permanently-denied";
            }
        } else {
            runtime = appEnabled ? "granted" : "denied";
        }

        JSObject result = new JSObject();
        result.put("appEnabled", appEnabled);
        result.put("runtime", runtime);
        result.put("asked", asked);
        NotificationChannel channel = manager == null ? null : readNotifyChannel(manager);
        result.put("channelId", channel == null ? null : channel.getId());
        result.put("channelName", channel == null ? null : channel.getName().toString());
        result.put("channelMuted", channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE);
        call.resolve(result);
    }

    /** 跳系统通知设置页；给了渠道 id 就直达该渠道。 */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        String channelId = call.getString("channelId", "");
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && channelId != null && !channelId.trim().isEmpty()) {
            intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId.trim());
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (ActivityNotFoundException error) {
            call.reject("打不开通知设置页", error);
        }
    }

    private NotificationChannel readNotifyChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        return manager.getNotificationChannel(NOTIFY_CHANNEL_ID);
    }

    /** 系统是否还会弹通知权限弹窗：false 且申请过就是「永久拒绝」。 */
    private boolean shouldShowRationale() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false;
        if (getActivity() == null) return false;
        return getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
    }

    private boolean ignoringBatteryOptimizations(Context context) {
        PowerManager manager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(context.getPackageName());
    }
}
