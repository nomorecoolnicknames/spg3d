package ru.spg3d.game;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Thermal telemetry for the in-game performance overlay / benchmark:
 * battery temperature, PowerManager thermal status and thermal headroom.
 * Also lets JS pin the window refresh rate (60 Hz saves power on 120 Hz panels).
 */
@CapacitorPlugin(name = "DeviceThermal")
public class DeviceThermalPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        Intent battery = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int t = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            if (t != Integer.MIN_VALUE) ret.put("batteryTempC", t / 10.0);
        }
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ret.put("thermalStatus", pm.getCurrentThermalStatus());
        }
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            float h = pm.getThermalHeadroom(10);
            if (!Float.isNaN(h)) ret.put("headroom", h);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void setRefreshRate(PluginCall call) {
        final float hz = call.getFloat("hz", 0f);
        getActivity().runOnUiThread(() -> {
            WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
            lp.preferredRefreshRate = hz;
            getActivity().getWindow().setAttributes(lp);
        });
        call.resolve();
    }
}
