// Searches a SPDF file with the C++ wrapper and prints the citation of the first hit.
//   spdf_search_cpp FILE QUERY
// SPDX-License-Identifier: MIT OR Apache-2.0
#include <iostream>
#include <string>

#include "spdf.hpp"

// Extracts the raw JSON value of `"key":` from a flat JSON object (enough for this demo;
// real programs use their JSON library).
static std::string member(const std::string &json, const std::string &key, std::size_t from = 0) {
    auto k = json.find("\"" + key + "\":", from);
    if (k == std::string::npos) return {};
    std::size_t i = k + key.size() + 3, depth = 0;
    bool in_str = false;
    for (std::size_t j = i; j < json.size(); ++j) {
        char c = json[j];
        if (in_str) {
            if (c == '\\') ++j;
            else if (c == '"') in_str = false;
            continue;
        }
        if (c == '"') in_str = true;
        else if (c == '{' || c == '[') ++depth;
        else if (c == '}' || c == ']') {
            if (depth == 0) return json.substr(i, j - i);
            --depth;
        } else if (c == ',' && depth == 0) return json.substr(i, j - i);
    }
    return json.substr(i);
}

int main(int argc, char **argv) {
    if (argc < 3) {
        std::cerr << "usage: " << argv[0] << " FILE QUERY\n";
        return 2;
    }
    try {
        spdf::Document doc(argv[1]);
        std::string hits = doc.search(argv[2], 5);
        std::cout << hits << "\n";
        std::string anchor = member(hits, "anchor");
        if (!anchor.empty()) std::cout << doc.cite(anchor, std::nullopt, "es") << "\n";
        std::cout << doc.bibtex();
    } catch (const spdf::Error &e) {
        std::cerr << "spdf error " << e.status() << ": " << e.what() << "\n";
        return 1;
    }
    return 0;
}
