// spdf.hpp: header-only C++17 wrapper over the SPDF C ABI (spdf.h).
// RAII handles, exceptions instead of status codes, std::string results. Complex values
// are JSON text: parse them with the JSON library of your project.
//
// SPDX-License-Identifier: MIT OR Apache-2.0
#ifndef SPDF_HPP
#define SPDF_HPP

#include <cstdint>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "spdf.h"

namespace spdf {

// Failure reported by the library: `status` (SPDF_ERR_*) and the JSON of spdf_last_error().
class Error : public std::runtime_error {
public:
    Error(int status, std::string detail) : std::runtime_error(detail), status_(status) {}
    int status() const noexcept { return status_; }

private:
    int status_;
};

namespace detail {
inline void check(int status) {
    if (status != SPDF_OK) throw Error(status, spdf_last_error());
}
inline std::string take(char *s) {
    std::unique_ptr<char, decltype(&spdf_string_free)> owner(s, &spdf_string_free);
    return s ? std::string(s) : std::string();
}
inline const char *opt(const std::optional<std::string> &s) { return s ? s->c_str() : nullptr; }
}  // namespace detail

inline std::string version() { return spdf_version(); }

// Validation report (JSON) of a file; does not throw for invalid files.
inline std::string validate(const std::string &path) {
    char *out = nullptr;
    detail::check(spdf_validate(path.c_str(), &out));
    return detail::take(out);
}

inline std::string anchor_uri(const std::string &docref, const std::string &anchor_json,
                              const std::optional<std::string> &anchor_end_json = std::nullopt) {
    char *out = nullptr;
    detail::check(spdf_anchor_uri_format(docref.c_str(), anchor_json.c_str(), detail::opt(anchor_end_json), &out));
    return detail::take(out);
}

// {"docref", "locator"} of an anchor URI; throws spdf::Error on malformed input.
inline std::string parse_uri(const std::string &uri) {
    char *out = nullptr;
    detail::check(spdf_anchor_uri_parse(uri.c_str(), &out));
    return detail::take(out);
}

inline std::string cite(const std::string &metadata_json, const std::string &anchor_json,
                        const std::optional<std::string> &anchor_end_json = std::nullopt,
                        const std::string &locale = "es") {
    char *out = nullptr;
    detail::check(spdf_cite(metadata_json.c_str(), anchor_json.c_str(), detail::opt(anchor_end_json), locale.c_str(), &out));
    return detail::take(out);
}

// Writes a 5.0 file from a canonical dump or a conformance source.
inline void write_from_dump(const std::string &dump_json, const std::string &path) {
    detail::check(spdf_write_from_dump(dump_json.c_str(), path.c_str()));
}

// An open SPDF document (read-only). Movable, not copyable.
class Document {
public:
    explicit Document(const std::string &path, const std::optional<std::string> &options_json = std::nullopt) {
        detail::check(spdf_open(path.c_str(), detail::opt(options_json), &doc_));
    }
    Document(Document &&o) noexcept : doc_(std::exchange(o.doc_, nullptr)) {}
    Document &operator=(Document &&o) noexcept {
        if (this != &o) {
            spdf_close(doc_);
            doc_ = std::exchange(o.doc_, nullptr);
        }
        return *this;
    }
    Document(const Document &) = delete;
    Document &operator=(const Document &) = delete;
    ~Document() { spdf_close(doc_); }

    std::string version() const { return call(spdf_doc_version); }
    std::string dump() const { return call(spdf_dump); }          // canonical, RFC 8785
    std::string meta() const { return call(spdf_meta); }
    std::string document() const { return call(spdf_document); }  // metadata = CSL-JSON
    std::string units() const { return call(spdf_units); }
    std::string fragments() const { return call(spdf_fragments); }
    std::string csl_json() const { return call(spdf_export_csl_json); }
    std::string bibtex() const { return call(spdf_export_bibtex); }

    std::string search(const std::string &query, std::uint32_t limit = 10) const {
        char *out = nullptr;
        detail::check(spdf_search_lexical(doc_, query.c_str(), limit, &out));
        return detail::take(out);
    }
    std::string search_vector(const std::string &space, const std::vector<float> &vec, std::uint32_t limit = 10,
                              const std::string &target = "fragment") const {
        char *out = nullptr;
        detail::check(spdf_search_vector(doc_, space.c_str(), target.c_str(), vec.data(), vec.size(), limit, &out));
        return detail::take(out);
    }
    std::string search_hybrid(const std::string &query, const std::string &space, const std::vector<float> &vec,
                              std::uint32_t limit = 10) const {
        char *out = nullptr;
        detail::check(spdf_search_hybrid(doc_, query.c_str(), space.c_str(), vec.data(), vec.size(), limit, &out));
        return detail::take(out);
    }
    std::string cite(const std::string &anchor_json, const std::optional<std::string> &anchor_end_json = std::nullopt,
                     const std::string &locale = "es") const {
        char *out = nullptr;
        detail::check(spdf_doc_cite(doc_, anchor_json.c_str(), detail::opt(anchor_end_json), locale.c_str(), &out));
        return detail::take(out);
    }
    // {"document","units","fragments","char","xywh"} of an anchor URI or a .spdf URL (SPEC §5.4).
    // {"text","uri","anchor","anchor_end"}: a quotation cited by the unit it lies in (SPEC §18.2).
    std::string cite_passage(const std::string &fragment_id, const std::string &quote, const std::string &locale = "es") const {
        char *out = nullptr;
        detail::check(spdf_cite_passage(doc_, fragment_id.c_str(), quote.c_str(), locale.c_str(), &out));
        return detail::take(out);
    }
    std::string locate(const std::string &reference) const {
        char *out = nullptr;
        detail::check(spdf_locate(doc_, reference.c_str(), &out));
        return detail::take(out);
    }
    // ALTO 4, TEI P5 or a IIIF Presentation 3 manifest (SPEC §19.4).
    std::string export_format(const std::string &format, const std::optional<std::string> &base_url = std::nullopt) const {
        char *out = nullptr;
        detail::check(spdf_export_format(doc_, format.c_str(), detail::opt(base_url), &out));
        return detail::take(out);
    }
    std::string alto() const { return export_format("alto"); }
    std::string tei() const { return export_format("tei"); }
    std::string iiif(const std::string &base_url) const { return export_format("iiif", base_url); }
    // Bytes of a blob (`key` or `blob:<key>`) and its media type; nullopt if absent.
    std::optional<std::pair<std::vector<std::uint8_t>, std::string>> blob(const std::string &key) const {
        std::uint8_t *data = nullptr;
        std::size_t len = 0;
        char *mime = nullptr;
        int st = spdf_blob(doc_, key.c_str(), &data, &len, &mime);
        if (st == SPDF_ERR_NOT_FOUND) return std::nullopt;
        detail::check(st);
        std::vector<std::uint8_t> bytes(data, data + len);
        spdf_bytes_free(data, len);
        return std::make_pair(std::move(bytes), detail::take(mime));
    }
    const SpdfDoc *handle() const noexcept { return doc_; }

private:
    template <typename F>
    std::string call(F f) const {
        char *out = nullptr;
        detail::check(f(doc_, &out));
        return detail::take(out);
    }
    SpdfDoc *doc_ = nullptr;
};

// CSL-JSON and BibTeX exports of several documents (keys disambiguated, SPEC §19).
inline std::string export_csl(const std::vector<const Document *> &docs,
                              const std::optional<std::string> &anchor_json = std::nullopt,
                              const std::optional<std::string> &anchor_end_json = std::nullopt) {
    std::vector<const SpdfDoc *> handles;
    for (const Document *d : docs) handles.push_back(d->handle());
    char *out = nullptr;
    detail::check(spdf_export_csl_multi(handles.data(), handles.size(), detail::opt(anchor_json), detail::opt(anchor_end_json), &out));
    return detail::take(out);
}

inline std::string export_bibtex(const std::vector<const Document *> &docs) {
    std::vector<const SpdfDoc *> handles;
    for (const Document *d : docs) handles.push_back(d->handle());
    char *out = nullptr;
    detail::check(spdf_export_bibtex_multi(handles.data(), handles.size(), &out));
    return detail::take(out);
}

}  // namespace spdf

#endif  // SPDF_HPP
