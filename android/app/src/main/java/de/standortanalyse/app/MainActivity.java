package de.standortanalyse.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Eigenständige App: Die Web-App ist ins APK gebündelt (assets/web) und läuft
 * offline sofort – ohne Server. Optional kann der Nutzer im Menü (langer Tipp
 * auf den Bildschirm) einen eigenen Server für Lizenz/Konto-Sync verbinden;
 * dann wird stattdessen dessen URL geladen.
 */
public class MainActivity extends Activity {

    private static final String BUNDLED = "file:///android_asset/web/index.html";
    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("app", MODE_PRIVATE);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // localStorage (Portfolio)
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                String host = u.getHost();
                String server = prefs.getString("server", null);
                // App-eigene Inhalte bleiben im WebView
                if ("file".equals(scheme)) return false;
                if (server != null && host != null && Uri.parse(server).getHost() != null
                        && host.equals(Uri.parse(server).getHost())) {
                    return false;
                }
                // Karten-/OSM-/externe Links extern öffnen
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                        return true;
                    } catch (Exception ignored) { return false; }
                }
                return false;
            }
        });

        // Langer Druck auf den Bildschirm öffnet die Server-Einstellung
        web.setOnLongClickListener(v -> { showServerDialog(); return false; });

        loadStart();
    }

    private void loadStart() {
        String server = prefs.getString("server", null);
        web.loadUrl(server != null ? server : BUNDLED);
    }

    private void showServerDialog() {
        String current = prefs.getString("server", null);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, 0);

        TextView info = new TextView(this);
        info.setText("Eigenen Server für Konto-Login, Lizenz & Geräte-Sync verbinden. "
                + "Leer lassen = eigenständige Offline-App nutzen.");
        box.addView(info);

        EditText input = new EditText(this);
        input.setHint("https://standorte.example.de");
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        if (current != null) input.setText(current);
        box.addView(input);

        new AlertDialog.Builder(this)
                .setTitle("Servermodus")
                .setView(box)
                .setPositiveButton("Verbinden", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.isEmpty() && !url.startsWith("http")) url = "https://" + url;
                    prefs.edit().putString("server", url.isEmpty() ? null : url).apply();
                    loadStart();
                })
                .setNeutralButton("Offline-App", (d, w) -> {
                    prefs.edit().remove("server").apply();
                    loadStart();
                })
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
