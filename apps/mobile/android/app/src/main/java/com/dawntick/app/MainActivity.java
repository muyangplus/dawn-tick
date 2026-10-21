package com.dawntick.app;

import android.os.Bundle;

import com.dawntick.app.install.ApkInstallerPlugin;
import com.dawntick.app.lan.LanSyncPlugin;
import com.dawntick.app.school.SchoolWindowPlugin;
import com.dawntick.app.share.FileSharePlugin;
import com.dawntick.app.system.SystemActionsPlugin;
import com.dawntick.app.widget.WidgetPinPlugin;
import com.dawntick.app.widget.WidgetRefreshPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
        super.onCreate(savedInstanceState);
    }
}
