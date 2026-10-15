package net.bruenecke.einschlafwoerter;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS side: web/js/native.js. start() runs in the tap that starts a session; stop() when it ends. */
@CapacitorPlugin(name = "Playback")
public class PlaybackPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            // Android 12+: not allowed from the background. Playback still runs, just without protection.
            call.reject("foreground service not allowed", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
    }
}
