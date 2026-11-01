package dev.smartboard.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Base64;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int EXPORT_REQUEST = 7;
    private WebView web;
    private ConnectionStore store;
    private final ExecutorService network = Executors.newFixedThreadPool(4);
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private String pendingExport;
    private boolean configuredDialog;

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store = new ConnectionStore(this);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(246,246,241));
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(14),0,dp(6),0);
        TextView title = new TextView(this); title.setText("Smartboard"); title.setTextColor(Color.rgb(49,94,66)); title.setTextSize(14);
        toolbar.addView(title,new LinearLayout.LayoutParams(0,dp(42),1)); title.setGravity(Gravity.CENTER_VERTICAL);
        Button refresh = new Button(this); refresh.setText("Reload"); refresh.setTextSize(11); refresh.setOnClickListener(v -> web.reload());
        Button connection = new Button(this); connection.setText("Server"); connection.setTextSize(11); connection.setOnClickListener(v -> showConnection());
        toolbar.addView(refresh,new LinearLayout.LayoutParams(dp(80),dp(40))); toolbar.addView(connection,new LinearLayout.LayoutParams(dp(80),dp(40)));
        root.addView(toolbar);
        web = new WebView(this); root.addView(web,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1)); setContentView(root);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false); settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(), "SmartboardAndroid"); web.setWebChromeClient(new WebChromeClient());
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder().addPathHandler("/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith(ORIGIN + "/")) return assets.shouldInterceptRequest(request.getUrl());
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new java.io.ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith(ORIGIN + "/")) return false;
                return true; // Never load remote content into a WebView containing the native bridge.
            }
        });
        web.loadUrl(ORIGIN + (store.url().isEmpty()?"/connect.html":"/index.html"));
    }

    private HttpURLConnection connect(String base, String token, String method, String path) throws Exception {
        HttpURLConnection conn = (HttpURLConnection)new URL(base + path).openConnection();
        conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(20000); conn.setReadTimeout(120000);
        conn.setRequestMethod(method); conn.setRequestProperty("Accept","application/json, text/event-stream");
        conn.setRequestProperty("Content-Type","application/json"); conn.setRequestProperty("Authorization","Bearer " + token);
        return conn;
    }
    private String checkConnection(String url, String token) throws Exception {
        HttpURLConnection health = connect(url,token,"GET","/api/v1/health");
        try {
            if (health.getResponseCode()!=200) throw new Exception("The backend did not return a successful health check.");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            try(InputStream input=health.getInputStream()){byte[] buffer=new byte[2048];int read;while((read=input.read(buffer))!=-1){bytes.write(buffer,0,read);if(bytes.size()>65536)throw new Exception("Unexpected health response");}}
            String data = new String(bytes.toByteArray(),StandardCharsets.UTF_8);
            new JSONObject(data).getJSONObject("data").getString("status");
        } finally { health.disconnect(); }
        HttpURLConnection boards = connect(url,token,"GET","/api/v1/boards");
        try { if(boards.getResponseCode()!=200) throw new Exception("Access denied. Check the app access token and backend authentication mode."); }
        finally { boards.disconnect(); }
        return url;
    }
    private void showConnection() {
        if(configuredDialog || isFinishing())return; configuredDialog = true;
        LinearLayout fields = new LinearLayout(this); fields.setOrientation(LinearLayout.VERTICAL); fields.setPadding(dp(22),dp(8),dp(22),0);
        TextView explanation = new TextView(this); explanation.setText("Connect to your Python backend. Enter its HTTPS base URL and your app access token. Your OpenAI key stays on the server."); explanation.setTextSize(13); fields.addView(explanation);
        EditText url = new EditText(this); url.setHint("https://your-app.onrender.com"); url.setSingleLine(true); url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); url.setText(store.url()); fields.addView(url);
        EditText token = new EditText(this); token.setHint("App access token"); token.setSingleLine(true); token.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD); fields.addView(token);
        try { token.setText(store.token()); } catch(Exception ignored) {}
        TextView status = new TextView(this); status.setTextSize(12); fields.addView(status);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Connect Smartboard").setView(fields).setNegativeButton("Cancel",null).setPositiveButton("Connect",null).create();
        dialog.setOnDismissListener(d -> configuredDialog = false);
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String base = url.getText().toString().trim().replaceAll("/+$", ""), secret = token.getText().toString().trim();
            try {
                Uri parsed = Uri.parse(base);
                if (!"https".equals(parsed.getScheme()) || parsed.getHost()==null || !parsed.getPath().isEmpty() || parsed.getUserInfo()!=null || parsed.getQuery()!=null || parsed.getFragment()!=null)
                    throw new Exception("Use an HTTPS base URL without /docs or /api.");
                if(secret.length()<32)throw new Exception("Enter the app access token configured on your backend (at least 32 characters).");
            } catch(Exception ex) { status.setText(ex.getMessage()); return; }
            status.setText("Connecting… A free server may take about a minute to wake up."); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            network.execute(() -> {
                try {
                    checkConnection(base,secret); store.save(base,secret);
                    runOnUiThread(() -> { if(!dialog.isShowing())return; dialog.dismiss(); web.clearHistory(); web.loadUrl(ORIGIN+"/index.html"); });
                } catch(Exception ex) { runOnUiThread(() -> { if(dialog.isShowing()){status.setText("Connection failed. Check the URL, token, internet connection, and server logs.");dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);} }); }
            });
        })); dialog.show();
    }
    private void emit(String id, String type, JSONObject values) {
        try { values.put("id",id);values.put("type",type);String json=values.toString();runOnUiThread(() -> {
            if(!isFinishing()) web.evaluateJavascript("window.__smartboardReceive && window.__smartboardReceive(" + json + ");",null);
        }); } catch(Exception ignored) {}
    }
    private JSONObject data(String key, Object value) { JSONObject object=new JSONObject();try{object.put(key,value);}catch(Exception ignored){}return object; }

    private final class Bridge {
        @JavascriptInterface public void configure() { runOnUiThread(() -> showConnection()); }
        @JavascriptInterface public String workspaceKey() { return store.url(); }
        @JavascriptInterface public void request(String id, String method, String path, String body, String headers) {
            if(!id.matches("[a-zA-Z0-9-]{1,80}") || !path.matches("/api/v1/[a-zA-Z0-9/_-]+") || !(method.equals("GET")||method.equals("POST")) || body.length()>2_000_000){emit(id,"error",data("message","Invalid app request."));return;}
            network.execute(() -> {
                HttpURLConnection conn=null;
                try {
                    if(cancelled.contains(id))return;
                    if(store.url().isEmpty())throw new Exception("Connect a backend using Server.");
                    conn=connect(store.url(),store.token(),method,path); active.put(id,conn);
                    if(cancelled.contains(id))return;
                    String operationKey=new JSONObject(headers).optString("Idempotency-Key","");
                    if(!operationKey.isEmpty())conn.setRequestProperty("Idempotency-Key",operationKey);
                    if(method.equals("POST")){conn.setDoOutput(true);try(OutputStream output=conn.getOutputStream()){output.write(body.getBytes(StandardCharsets.UTF_8));}}
                    int code=conn.getResponseCode();JSONObject meta=data("status",code);meta.put("contentType",conn.getContentType()==null?"application/json":conn.getContentType());emit(id,"headers",meta);
                    InputStream input=code>=400?conn.getErrorStream():conn.getInputStream();
                    if(input!=null)try(InputStream reader=input){
                        byte[] buffer=new byte[2048];int read;while((read=reader.read(buffer))!=-1){if(cancelled.contains(id))return;emit(id,"chunk",data("bytes",Base64.encodeToString(buffer,0,read,Base64.NO_WRAP)));}
                    }
                    emit(id,"done",new JSONObject());
                } catch(Exception ex){emit(id,"error",data("message","Could not reach your backend. Check internet and Server settings; a free host may need time to wake up."));}
                finally {active.remove(id);cancelled.remove(id);if(conn!=null)conn.disconnect();}
            });
        }
        @JavascriptInterface public void cancel(String id) {cancelled.add(id);HttpURLConnection connection=active.remove(id);if(connection!=null)connection.disconnect();}
        @JavascriptInterface public void exportJson(String name, String json) {
            if(json.length()>3_000_000)return;
            runOnUiThread(() -> {pendingExport=json;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,name.replaceAll("[^a-zA-Z0-9._-]","-"));startActivityForResult(intent,EXPORT_REQUEST);});
        }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent result){
        super.onActivityResult(requestCode,resultCode,result);
        if(requestCode==EXPORT_REQUEST&&resultCode==RESULT_OK&&result!=null&&result.getData()!=null&&pendingExport!=null){
            try(OutputStream output=getContentResolver().openOutputStream(result.getData())){output.write(pendingExport.getBytes(StandardCharsets.UTF_8));Toast.makeText(this,"Board exported",Toast.LENGTH_SHORT).show();}
            catch(Exception ex){Toast.makeText(this,"Could not export board",Toast.LENGTH_LONG).show();}
        }pendingExport=null;
    }
    @Override public void onBackPressed(){new AlertDialog.Builder(this).setMessage("Leave Smartboard? Make sure your board shows All changes saved.").setNegativeButton("Stay",null).setPositiveButton("Leave",(d,w)->finish()).show();}
    @Override protected void onDestroy(){for(HttpURLConnection conn:active.values())conn.disconnect();active.clear();network.shutdownNow();web.removeJavascriptInterface("SmartboardAndroid");web.destroy();super.onDestroy();}
}
