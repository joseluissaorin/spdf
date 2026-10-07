"""
    SpdfError(code, message)

Failure while opening, reading or writing a SPDF file. `code` is the validation code
of the specification (`"E001"` not SQLite, `"E002"` unknown version, `"E020"` trigger
or view, `"E060"` unknown required extension...).
"""
struct SpdfError <: Exception
    code::String
    message::String
end

Base.showerror(io::IO, e::SpdfError) = print(io, "SpdfError [", e.code, "] ", e.message)

spdf_error(code, msg) = throw(SpdfError(code, msg))
