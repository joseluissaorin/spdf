package io.github.joseluissaorin.spdf.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.joseluissaorin.spdf.Anchor;
import io.github.joseluissaorin.spdf.AnchorUri;
import io.github.joseluissaorin.spdf.CitableUnit;
import io.github.joseluissaorin.spdf.Document;
import io.github.joseluissaorin.spdf.Fragment;
import io.github.joseluissaorin.spdf.Hit;
import io.github.joseluissaorin.spdf.Json;
import io.github.joseluissaorin.spdf.Spdf;
import io.github.joseluissaorin.spdf.SpdfFile;
import io.github.joseluissaorin.spdf.SpdfWriter;
import io.github.joseluissaorin.spdf.ValidationResult;
import io.github.joseluissaorin.spdf.Validator;
import io.github.joseluissaorin.spdf.WriterOptions;
import java.io.File;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The library as Java code sees it: static entry points, constructors plus setters, no Kotlin types. */
class JavaInteropTest {
    @Test
    void writeSearchCiteFromJava() throws Exception {
        File dir = Files.createTempDirectory("spdf-java").toFile();
        File out = new File(dir, "lazarillo.spdf");

        try (SpdfWriter w = SpdfWriter.create(out.getPath())) {
            Document d = new Document("lazarillo", "pdf", "application/pdf", "ab".repeat(32),
                Map.of("type", "book", "title", "La vida de Lazarillo de Tormes",
                       "issued", Map.of("date-parts", List.of(List.of(1554)))));
            d.setTitle("Lazarillo de Tormes");
            w.setDocument(d);
            w.addUnit(new CitableUnit("u1", Anchor.page(3, "A2r", "read", "leaf"), "Pues sepa Vuestra Merced", "pdf-text-layer"));
            Fragment f = new Fragment("f1", "u1", "Pues sepa Vuestra Merced", Anchor.page(3, "A2r", "read", "leaf"));
            f.setContext("Prólogo");
            w.addFragment(f);
            w.finish();
        }

        ValidationResult r = Spdf.validate(out.getPath());
        assertTrue(r.isValid(), r.toString());
        assertTrue(r.getErrorCodes().isEmpty());

        try (SpdfFile file = SpdfFile.open(out.getPath())) {
            List<Hit> hits = file.searchLexical("merced");
            assertEquals(1, hits.size());
            Hit h = hits.get(0);
            assertEquals("f1", h.getFragmentId());
            assertEquals("(La vida de Lazarillo de Tormes, 1554, fol. A2r)", file.cite(h.getAnchor()));
            assertTrue(h.getAnchorUri().endsWith("#p=3&f=A2r"), h.getAnchorUri());
            AnchorUri.Parsed p = Spdf.parseUri(h.getAnchorUri());
            assertEquals(Long.valueOf(3), p.getLocator().getP());
            assertFalse(file.dumpJson().isEmpty());
            assertEquals(64, file.contentSha256().length());
        }

        // Every static entry point is reachable from Java, including the default adapter.
        assertTrue(io.github.joseluissaorin.spdf.sql.SqlDriver.defaultDriver() instanceof JdbcSqlDriver);
        byte[] seed = new byte[32];
        File signed = new File(dir, "signed.spdf");
        try (SpdfWriter w = SpdfWriter.create(signed, new WriterOptions("java/1", false, false, true, seed))) {
            w.setDocument(new Document("s", "document", "text/plain", "cd".repeat(32), Map.of("type", "book", "title", "Rimas")));
            w.finish();
        }
        assertTrue(Spdf.validate(signed.getPath()).isValid());

        Map<String, Object> md = Json.parseObject("{\"title\":\"Rimas\",\"author\":[{\"family\":\"Bécquer\"}],\"issued\":{\"date-parts\":[[1871]]}}");
        assertEquals("(Bécquer, 1871, v. 12)", Spdf.cite(Anchor.verse(12), null, md, "en"));
        assertEquals(List.of(), Validator.validate(out.getPath()).getWarningCodes());
    }
}
