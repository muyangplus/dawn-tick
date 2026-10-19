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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统级动作：用系统浏览器打开外部链接、跳到电池优化白名单申请页、读通知状态。
 * 外部链接不走 window.open：WebView 那条路在 Android 11+ 会先卡在包可见性判断上，表现为「打开失败」。
 */
@CapacitorPlugin(name = "SystemActions")
public class SystemActionsPlugin extends Plugin {

    /** 课前提醒走本地通知插件创建的渠道；静音判断按这个渠道看。 */
    private static final String NOTIFY_CHANNEL_ID = "default";
    /** 用 ACTION_VIEW 交给系统浏览器；没有浏览器时 resolve 失败原因。 */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少链接地址");
            return;
        }
        String trimmed = url.trim();
        Uri uri = Uri.parse(trimmed);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) {
            call.reject("只支持 http 与 https 链接");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (ActivityNotFoundException error) {
            call.reject("没有可打开该链接的应用", error);
        }
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
