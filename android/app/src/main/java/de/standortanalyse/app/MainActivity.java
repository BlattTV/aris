package de.standortanalyse.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

/**
 * Minimaler WebView-Wrapper um die selbst gehostete Web-App
 * (LXC-Container im LAN oder Internet). Die Server-Adresse wird beim
 * ersten Start abgefragt und gespeichert; bei Verbindungsfehlern
 * erscheint der Dialog erneut.
 */
public class MainActivity extends Activity {

    private WebView web;
    private SharedPreferences prefs;
    private boolean dialogShowing = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("app", MODE_PRIVATE);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage für Portfolio-Daten

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                String serverHost = getServerHost();
                // Eigener Server bleibt in der App, externe Links (OSM-
                // Attribution etc.) öffnen im Browser.
                if (target.getHost() != null && target.getHost().equals(serverHost)) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    askForUrl(getString(R.string.url_prompt_error));
                }
            }
        });

        String url = prefs.getString("url", null);
        if (url == null) {
            askForUrl(getString(R.string.url_prompt_first));
        } else {
            web.loadUrl(url);
        }
    }

    private String getServerHost() {
        String url = prefs.getString("url", "");
        Uri u = Uri.parse(url);
        return u.getHost();
    }

    private void askForUrl(String title) {
        if (dialogShowing) return;
        dialogShowing = true;

        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint(R.string.url_hint);
        String current = prefs.getString("url", null);
        if (current != null) input.setText(current);

        new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(input)
                .setCancelable(current != null)
                .setOnDismissListener(d -> dialogShowing = false)
                .setPositiveButton(R.string.connect, (dialog, which) -> {
                    String url = input.getText().toString().trim();
                    if (url.isEmpty()) return;
                    if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        url = "http://" + url;
                    }
                    prefs.edit().putString("url", url).apply();
                    web.loadUrl(url);
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
