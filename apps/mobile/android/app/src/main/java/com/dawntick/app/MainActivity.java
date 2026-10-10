package com.dawntick.app;

import android.os.Bundle;

import com.dawntick.app.widget.WidgetRefreshPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetRefreshPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
