package com.dawntick.app.system;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统级动作：用系统浏览器打开外部链接、跳到电池优化白名单申请页。
 * 外部链接不走 window.open：WebView 那条路在 Android 11+ 会先卡在包可见性判断上，表现为「打开失败」。
 */
@CapacitorPlugin(name = "SystemActions")
public class SystemActionsPlugin extends Plugin {

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

    private boolean ignoringBatteryOptimizations(Context context) {
        PowerManager manager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(context.getPackageName());
    }
}
