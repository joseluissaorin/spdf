// Command spdf is the command-line interface of the Go implementation of SPDF.
//
//	spdf validate FILE            validation report (JSON)
//	spdf dump FILE                canonical dump (RFC 8785 JSON)
//	spdf search FILE QUERY [-n N] lexical search
//	spdf vsearch FILE SPACE V1,V2,… [-n N]
//	spdf cite FILE FRAGMENT_ID [-locale es|en]
//	spdf export FILE csl|bibtex|alto|tei|iiif
//	spdf uri parse URI
//	spdf build SOURCE.json OUT.spdf
//	spdf seal FILE [-key SEED]
//	spdf conformance [DIR] [-o conformance.json]
package main

import (
	"crypto/ed25519"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	spdf "github.com/joseluissaorin/spdf/go"
	"github.com/joseluissaorin/spdf/go/conformance"
)

func usage() {
	fmt.Fprint(os.Stderr, `usage:
  spdf validate FILE
  spdf dump FILE
  spdf search FILE QUERY [-n N]
  spdf vsearch FILE SPACE V1,V2,... [-n N]
  spdf cite FILE FRAGMENT_ID [-locale es|en]
  spdf export FILE csl|bibtex|alto|tei|iiif
  spdf uri parse URI
  spdf build SOURCE.json OUT.spdf
  spdf seal FILE [-key SEED]       content_sha256 (and Ed25519 signature) in place
  spdf conformance [DIR] [-o conformance.json]
  spdf version
`)
	os.Exit(2)
}

func die(err error) {
	fmt.Fprintln(os.Stderr, "spdf:", err)
	os.Exit(1)
}

func out(v any) {
	os.Stdout.Write(spdf.CanonicalJSON(v))
	os.Stdout.Write([]byte("\n"))
}

func hitsJSON(hits []spdf.Hit) []any {
	l := make([]any, len(hits))
	for i, h := range hits {
		l[i] = h.Generic()
	}
	return l
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	n := fs.Int("n", 10, "maximum number of results")
	locale := fs.String("locale", "es", "citation locale (es, en)")
	output := fs.String("o", "", "also write the report to this file")
	keyFile := fs.String("key", "", "Ed25519 seed file (32 bytes, raw, hex or base64) to sign with")
	var pos []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			die(err)
		}
		args = fs.Args()
		if len(args) > 0 {
			pos = append(pos, args[0])
			args = args[1:]
		}
	}
	need := func(k int) {
		if len(pos) < k {
			usage()
		}
	}
	switch cmd {
	case "version":
		fmt.Println(spdf.ImplName, spdf.Version, "(SPDF", spdf.FormatVersion+")")
	case "validate":
		need(1)
		r := spdf.Validate(pos[0], nil)
		out(r.Generic())
		if !r.Valid {
			os.Exit(1)
		}
	case "dump":
		need(1)
		f, err := spdf.Open(pos[0], nil)
		if err != nil {
			die(err)
		}
		defer f.Close()
		d, err := f.DumpJSON()
		if err != nil {
			die(err)
		}
		os.Stdout.Write(append(d, '\n'))
	case "search":
		need(2)
		f, err := spdf.Open(pos[0], nil)
		if err != nil {
			die(err)
		}
		defer f.Close()
		hits, err := f.SearchLexical(strings.Join(pos[1:], " "), *n)
		if err != nil {
			die(err)
		}
		out(hitsJSON(hits))
	case "vsearch":
		need(3)
		f, err := spdf.Open(pos[0], nil)
		if err != nil {
			die(err)
		}
		defer f.Close()
		var v []float64
		for _, p := range strings.Split(pos[2], ",") {
			x, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
			if err != nil {
				die(err)
			}
			v = append(v, x)
		}
		hits, err := f.SearchVector(v, pos[1], "fragment", *n)
		if err != nil {
			die(err)
		}
		out(hitsJSON(hits))
	case "cite":
		need(2)
		f, err := spdf.Open(pos[0], nil)
		if err != nil {
			die(err)
		}
		defer f.Close()
		a, end, err := f.FragmentAnchors(pos[1])
		if err != nil {
			die(err)
		}
		c, err := f.Cite(a, end, *locale)
		if err != nil {
			die(err)
		}
		fmt.Println(c)
	case "export":
		need(2)
		f, err := spdf.Open(pos[0], nil)
		if err != nil {
			die(err)
		}
		defer f.Close()
		switch pos[1] {
		case "csl":
			b, err := f.ExportCSL()
			if err != nil {
				die(err)
			}
			os.Stdout.Write(append(b, '\n'))
		case "bibtex":
			b, err := f.ExportBibTeX()
			if err != nil {
				die(err)
			}
			fmt.Print(b)
		case "alto":
			b, err := f.ExportALTO()
			if err != nil {
				die(err)
			}
			fmt.Print(b)
		case "tei":
			b, err := f.ExportTEI()
			if err != nil {
				die(err)
			}
			fmt.Print(b)
		case "iiif":
			m, err := f.ExportIIIF("")
			if err != nil {
				die(err)
			}
			out(m)
		default:
			usage()
		}
	case "uri":
		need(2)
		if pos[0] != "parse" {
			usage()
		}
		ref, loc, err := spdf.ParseURI(pos[1])
		if err != nil {
			die(err)
		}
		out(map[string]any{"docref": ref, "locator": loc.Generic(), "canonical": spdf.FormatURI(ref, loc)})
	case "build":
		need(2)
		src, err := spdf.ReadSource(pos[0])
		if err != nil {
			die(err)
		}
		if err := spdf.WriteSource(src, pos[1]); err != nil {
			die(err)
		}
	case "seal":
		need(1)
		var key ed25519.PrivateKey
		if *keyFile != "" {
			k, err := spdf.ReadSigningKey(*keyFile)
			if err != nil {
				die(err)
			}
			key = k
		}
		if err := spdf.Seal(pos[0], key); err != nil {
			die(err)
		}
	case "conformance":
		dir := "conformance"
		if len(pos) > 0 {
			dir = pos[0]
		}
		rep, err := conformance.Run(dir)
		if err != nil {
			die(err)
		}
		js := append(rep.JSON(), '\n')
		os.Stdout.Write(js)
		if *output != "" {
			if err := os.WriteFile(*output, js, 0o644); err != nil {
				die(err)
			}
		}
		fmt.Fprintf(os.Stderr, "%d passed, %d failed, %d skipped\n", len(rep.Passed), len(rep.Failed), len(rep.Skipped))
		if len(rep.Failed) > 0 {
			os.Exit(1)
		}
	default:
		usage()
	}
}
