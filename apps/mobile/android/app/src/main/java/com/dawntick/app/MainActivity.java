package com.dawntick.app;

import android.os.Bundle;

import com.dawntick.app.school.SchoolWindowPlugin;
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
        super.onCreate(savedInstanceState);
    }
}
