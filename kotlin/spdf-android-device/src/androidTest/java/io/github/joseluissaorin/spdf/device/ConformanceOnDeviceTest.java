package io.github.joseluissaorin.spdf.device;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Build;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import io.github.joseluissaorin.spdf.Json;
import io.github.joseluissaorin.spdf.android.AndroidxSqlDriver;
import io.github.joseluissaorin.spdf.conformance.CaseResult;
import io.github.joseluissaorin.spdf.conformance.ConformanceReport;
import io.github.joseluissaorin.spdf.conformance.ConformanceRunner;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the whole SPDF conformance suite on the device, with the androidx.sqlite bundled adapter. */
@RunWith(AndroidJUnit4.class)
public class ConformanceOnDeviceTest {
    private static final String TAG = "SpdfConformance";
    private static final String[] SUITE = {
        "manifest.json", "cases", "files", "legacy", "invalid", "expected", "sources", "legacy-sources",
    };

    private static void copy(AssetManager assets, String path, File to) throws IOException {
        String[] children = assets.list(path);
        if (children != null && children.length > 0) {
            if (!to.isDirectory() && !to.mkdirs()) throw new IOException("cannot create " + to);
            for (String c : children) copy(assets, path + "/" + c, new File(to, c));
            return;
        }
        File parent = to.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);
        try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        f.delete();
    }

    @Test
    public void wholeSuitePassesOnDevice() throws Exception {
        Context ctx = InstrumentationRegistry.getInstrumentation().getContext();
        File dir = new File(ctx.getCacheDir(), "conformance");
        delete(dir);
        for (String entry : SUITE) copy(ctx.getAssets(), entry, new File(dir, entry));
        File cases = new File(dir, "cases");
        String[] listed = cases.list();
        assertTrue("no cases copied", listed != null && listed.length > 0);

        ConformanceReport rep = new ConformanceRunner(new AndroidxSqlDriver(), "spdf-kotlin").run(dir);
        String where = Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";
        Log.i(TAG, where + ": " + rep.summary());
        try (OutputStream out = new FileOutputStream(new File(ctx.getCacheDir(), "conformance.json"))) {
            out.write(Json.compact(rep).getBytes(StandardCharsets.UTF_8));
        }
        StringBuilder failures = new StringBuilder();
        for (CaseResult f : rep.getFailed()) {
            Log.e(TAG, f.getId() + ": " + f.getReason());
            failures.append('\n').append(f.getId()).append(": ").append(f.getReason());
        }
        assertEquals(where + ": " + rep.summary() + failures, 0, rep.getFailed().size());
        delete(dir);
    }
}
