package com.dawntick.app;

import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;

import com.dawntick.app.diag.NativeLog;
import com.dawntick.app.install.ApkInstallerPlugin;
import com.dawntick.app.lan.LanSyncPlugin;
import com.dawntick.app.reminder.ReminderActionsPlugin;
import com.dawntick.app.school.SchoolWindowPlugin;
import com.dawntick.app.secret.SecretStorePlugin;
import com.dawntick.app.share.FileSharePlugin;
import com.dawntick.app.system.SystemActionsPlugin;
import com.dawntick.app.widget.WidgetPinPlugin;
import com.dawntick.app.widget.WidgetRefreshPlugin;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 启动自检用的插件名，与下面 registerPlugin 的顺序一一对应。 */
    private static final String[] PLUGIN_NAMES = {
        "WidgetRefresh",
        "SchoolWindow",
        "DawnTickWidget",
        "SystemActions",
        "ApkInstaller",
        "FileShare",
        "LanSync",
        "ReminderActions",
        "SecretStore",
    };
    private static final String TAG = "startup";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetRefreshPlugin.class);
        registerPlugin(SchoolWindowPlugin.class);
        registerPlugin(WidgetPinPlugin.class);
        registerPlugin(SystemActionsPlugin.class);
        // I-03 自动更新、I-12 导出：交给系统安装器 / 分享面板，Web 侧接线在后续批次
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(FileSharePlugin.class);
        // I-14 局域网同步：安卓作为服务端时起本机 HTTP 监听，鉴权与数据都在 Web 层
        registerPlugin(LanSyncPlugin.class);
        // R-07 提醒动作：提醒投递、通知按钮与贪睡/完成/勿扰
        registerPlugin(ReminderActionsPlugin.class);
        // WebDAV 密码：AndroidKeyStore AES-GCM 加解密（Web 侧封 `enc:v1:` 信封）
        registerPlugin(SecretStorePlugin.class);
        super.onCreate(savedInstanceState);
        logStartupSelfCheck();
    }

    /**
     * 启动自检：把版本与插件注册结果写进 `filesDir/diag/native.log`。
     *
     * 真机上「自定义插件整体没注册」和「某个方法调用失败」表现不同，
     * 有了这条基线日志，配合 openExternal / SchoolWindow / WidgetStore 的日志就能分清是哪一类。
     * 自检本身失败不能影响启动，所以吞掉所有异常并记录。
     */
    private void logStartupSelfCheck() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            NativeLog.info(
                    this,
                    TAG,
                    "启动 版本=" + info.versionName + " (" + versionCode + ") SDK=" + Build.VERSION.SDK_INT
            );
            Bridge bridge = getBridge();
            if (bridge == null) {
                NativeLog.warn(this, TAG, "Bridge 为空，插件自检跳过");
                return;
            }
            StringBuilder ready = new StringBuilder();
            StringBuilder missing = new StringBuilder();
            for (String name : PLUGIN_NAMES) {
                if (bridge.getPlugin(name) == null) {
                    if (missing.length() > 0) missing.append(',');
                    missing.append(name);
                } else {
                    if (ready.length() > 0) ready.append(',');
                    ready.append(name);
                }
            }
            NativeLog.info(
                    this,
                    TAG,
                    "插件自检 已注册=" + ready + " 缺失=" + (missing.length() == 0 ? "无" : missing)
            );
        } catch (Throwable error) {
            NativeLog.error(this, TAG, "启动自检失败", error);
        }
    }
}
