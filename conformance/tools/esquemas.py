"""A minimal JSON Schema (2020-12) checker, standard library only.

It supports the keywords the SPDF schemas use (type, enum, const, properties, required,
additionalProperties, items, minItems, maxItems, contains, minimum, maximum, pattern,
oneOf, anyOf, allOf, $ref to "#/$defs/…" and to other schemas by $id). verificar.py uses
it to check that `spec/json-schema/*.json` agree with the conformance corpus. It is not a
general validator.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


class Schemas:
    def __init__(self, folder: Path):
        self.by_id = {}
        for p in sorted(Path(folder).glob("*.schema.json")):
            s = json.loads(p.read_text(encoding="utf-8"))
            self.by_id[s["$id"]] = s

    def get(self, name: str) -> dict:
        for k, v in self.by_id.items():
            if k.endswith("/" + name):
                return v
        raise KeyError(name)

    def errors(self, instance, schema: dict, root: dict | None = None, path: str = "$") -> list[str]:
        root = root or schema
        out: list[str] = []
        if schema is True or schema == {}:
            return out
        if "$ref" in schema:
            ref = schema["$ref"]
            if ref.startswith("#"):
                target, troot = self._pointer(root, ref[1:]), root
            else:
                base, _, frag = ref.partition("#")
                troot = self.by_id[base]
                target = self._pointer(troot, frag) if frag else troot
            out += self.errors(instance, target, troot, path)
        t = schema.get("type")
        if t is not None:
            types = t if isinstance(t, list) else [t]
            if not any(self._is(instance, x) for x in types):
                return out + [f"{path}: expected {t}, got {type(instance).__name__}"]
        if "const" in schema and not self._eq(instance, schema["const"]):
            out.append(f"{path}: expected {schema['const']!r}")
        if "enum" in schema and not any(self._eq(instance, e) for e in schema["enum"]):
            out.append(f"{path}: {instance!r} not in {schema['enum']}")
        if isinstance(instance, (int, float)) and not isinstance(instance, bool):
            if "minimum" in schema and instance < schema["minimum"]:
                out.append(f"{path}: {instance} < {schema['minimum']}")
            if "maximum" in schema and instance > schema["maximum"]:
                out.append(f"{path}: {instance} > {schema['maximum']}")
        if isinstance(instance, str) and "pattern" in schema and not re.search(schema["pattern"], instance):
            out.append(f"{path}: {instance!r} does not match {schema['pattern']}")
        if isinstance(instance, dict):
            for k in schema.get("required", []):
                if k not in instance:
                    out.append(f"{path}: missing {k}")
            props = schema.get("properties", {})
            for k, v in instance.items():
                if k in props:
                    out += self.errors(v, props[k], root, f"{path}.{k}")
                elif "additionalProperties" in schema:
                    ap = schema["additionalProperties"]
                    if ap is False:
                        out.append(f"{path}: unexpected {k}")
                    elif isinstance(ap, dict):
                        out += self.errors(v, ap, root, f"{path}.{k}")
        if isinstance(instance, list):
            if "minItems" in schema and len(instance) < schema["minItems"]:
                out.append(f"{path}: fewer than {schema['minItems']} items")
            if "maxItems" in schema and len(instance) > schema["maxItems"]:
                out.append(f"{path}: more than {schema['maxItems']} items")
            if "items" in schema:
                for i, v in enumerate(instance):
                    out += self.errors(v, schema["items"], root, f"{path}[{i}]")
            if "contains" in schema and not any(not self.errors(v, schema["contains"], root) for v in instance):
                out.append(f"{path}: no item matches 'contains'")
        for sub in schema.get("allOf", []):
            out += self.errors(instance, sub, root, path)
        if "anyOf" in schema and not any(not self.errors(instance, s, root, path) for s in schema["anyOf"]):
            out.append(f"{path}: matches none of anyOf")
        if "oneOf" in schema:
            n = sum(1 for s in schema["oneOf"] if not self.errors(instance, s, root, path))
            if n != 1:
                out.append(f"{path}: matches {n} of oneOf (must be exactly 1)")
        return out

    @staticmethod
    def _pointer(doc, pointer: str):
        cur = doc
        for part in [p for p in pointer.split("/") if p]:
            cur = cur[part.replace("~1", "/").replace("~0", "~")]
        return cur

    @staticmethod
    def _is(v, t: str) -> bool:
        if t == "null":
            return v is None
        if t == "boolean":
            return isinstance(v, bool)
        if t == "object":
            return isinstance(v, dict)
        if t == "array":
            return isinstance(v, list)
        if t == "string":
            return isinstance(v, str)
        if t == "number":
            return isinstance(v, (int, float)) and not isinstance(v, bool)
        if t == "integer":
            return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())
        return False

    @staticmethod
    def _eq(a, b) -> bool:
        if isinstance(a, bool) or isinstance(b, bool):
            return a is b
        return a == b
