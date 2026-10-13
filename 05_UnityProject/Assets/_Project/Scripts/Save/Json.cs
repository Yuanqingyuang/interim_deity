using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace InterimDeity.Save
{
    public sealed class JsonException : Exception
    {
        public JsonException(string message) : base(message) { }
    }

    public enum JsonKind
    {
        Null,
        Bool,
        Number,
        String,
        Array,
        Object
    }

    public sealed class JsonValue
    {
        public JsonKind Kind;
        public bool BoolValue;
        public double NumberValue;
        public string StringValue;
        public List<JsonValue> ArrayValue;
        public Dictionary<string, JsonValue> ObjectValue;

        public static readonly JsonValue Null = new JsonValue { Kind = JsonKind.Null };

        public bool TryGet(string key, out JsonValue value)
        {
            value = null;
            if (Kind != JsonKind.Object || ObjectValue == null) return false;
            return ObjectValue.TryGetValue(key, out value);
        }
    }

    public sealed class JsonBuilder
    {
        private readonly StringBuilder _sb = new StringBuilder();
        private bool _needComma;

        private void Pre()
        {
            if (_needComma) _sb.Append(',');
        }

        public JsonBuilder ObjectStart()
        {
            Pre();
            _sb.Append('{');
            _needComma = false;
            return this;
        }

        public JsonBuilder ObjectEnd()
        {
            _sb.Append('}');
            _needComma = true;
            return this;
        }

        public JsonBuilder ArrayStart()
        {
            Pre();
            _sb.Append('[');
            _needComma = false;
            return this;
        }

        public JsonBuilder ArrayEnd()
        {
            _sb.Append(']');
            _needComma = true;
            return this;
        }

        public JsonBuilder Key(string key)
        {
            Pre();
            AppendString(key);
            _sb.Append(':');
            _needComma = false;
            return this;
        }

        public JsonBuilder String(string value)
        {
            Pre();
            AppendString(value ?? "");
            _needComma = true;
            return this;
        }

        public JsonBuilder Bool(bool value)
        {
            Pre();
            _sb.Append(value ? "true" : "false");
            _needComma = true;
            return this;
        }

        public JsonBuilder Number(int value)
        {
            Pre();
            _sb.Append(value.ToString(CultureInfo.InvariantCulture));
            _needComma = true;
            return this;
        }

        public JsonBuilder Number(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
                throw new JsonException("non-finite number not allowed");
            Pre();
            _sb.Append(value.ToString("R", CultureInfo.InvariantCulture));
            _needComma = true;
            return this;
        }

        public JsonBuilder Number(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value))
                throw new JsonException("non-finite number not allowed");
            Pre();
            _sb.Append(value.ToString("R", CultureInfo.InvariantCulture));
            _needComma = true;
            return this;
        }

        public JsonBuilder RawNumber(string text)
        {
            Pre();
            _sb.Append(text);
            _needComma = true;
            return this;
        }

        private void AppendString(string s)
        {
            _sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': _sb.Append("\\\""); break;
                    case '\\': _sb.Append("\\\\"); break;
                    case '\b': _sb.Append("\\b"); break;
                    case '\f': _sb.Append("\\f"); break;
                    case '\n': _sb.Append("\\n"); break;
                    case '\r': _sb.Append("\\r"); break;
                    case '\t': _sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            _sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            _sb.Append(c);
                        break;
                }
            }
            _sb.Append('"');
        }

        public override string ToString() => _sb.ToString();
    }

    public sealed class JsonParser
    {
        private readonly string _s;
        private int _i;

        private JsonParser(string s)
        {
            _s = s;
        }

        public static JsonValue Parse(string text)
        {
            if (text == null) throw new JsonException("null input");
            var p = new JsonParser(text);
            p.SkipWs();
            JsonValue v = p.ParseValue();
            p.SkipWs();
            if (p._i != p._s.Length) throw new JsonException("trailing content at " + p._i);
            return v;
        }

        private void SkipWs()
        {
            while (_i < _s.Length)
            {
                char c = _s[_i];
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') _i++;
                else break;
            }
        }

        private char Peek()
        {
            if (_i >= _s.Length) throw new JsonException("unexpected end of input");
            return _s[_i];
        }

        private JsonValue ParseValue()
        {
            char c = Peek();
            switch (c)
            {
                case '{': return ParseObject();
                case '[': return ParseArray();
                case '"': return new JsonValue { Kind = JsonKind.String, StringValue = ParseString() };
                case 't': Expect("true"); return new JsonValue { Kind = JsonKind.Bool, BoolValue = true };
                case 'f': Expect("false"); return new JsonValue { Kind = JsonKind.Bool, BoolValue = false };
                case 'n': Expect("null"); return JsonValue.Null;
                default: return ParseNumber();
            }
        }

        private void Expect(string word)
        {
            if (_i + word.Length > _s.Length || string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0)
                throw new JsonException("invalid literal at " + _i);
            _i += word.Length;
        }

        private JsonValue ParseObject()
        {
            var obj = new Dictionary<string, JsonValue>();
            _i++;
            SkipWs();
            if (Peek() == '}') { _i++; return new JsonValue { Kind = JsonKind.Object, ObjectValue = obj }; }
            while (true)
            {
                SkipWs();
                if (Peek() != '"') throw new JsonException("expected object key at " + _i);
                string key = ParseString();
                if (obj.ContainsKey(key)) throw new JsonException("duplicate key: " + key);
                SkipWs();
                if (Peek() != ':') throw new JsonException("expected ':' at " + _i);
                _i++;
                SkipWs();
                obj[key] = ParseValue();
                SkipWs();
                char c = Peek();
                if (c == ',') { _i++; continue; }
                if (c == '}') { _i++; break; }
                throw new JsonException("expected ',' or '}' at " + _i);
            }
            return new JsonValue { Kind = JsonKind.Object, ObjectValue = obj };
        }

        private JsonValue ParseArray()
        {
            var arr = new List<JsonValue>();
            _i++;
            SkipWs();
            if (Peek() == ']') { _i++; return new JsonValue { Kind = JsonKind.Array, ArrayValue = arr }; }
            while (true)
            {
                SkipWs();
                arr.Add(ParseValue());
                SkipWs();
                char c = Peek();
                if (c == ',') { _i++; continue; }
                if (c == ']') { _i++; break; }
                throw new JsonException("expected ',' or ']' at " + _i);
            }
            return new JsonValue { Kind = JsonKind.Array, ArrayValue = arr };
        }

        private string ParseString()
        {
            _i++;
            var sb = new StringBuilder();
            while (true)
            {
                if (_i >= _s.Length) throw new JsonException("unterminated string");
                char c = _s[_i++];
                if (c == '"') break;
                if (c == '\\')
                {
                    if (_i >= _s.Length) throw new JsonException("unterminated escape");
                    char e = _s[_i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 > _s.Length) throw new JsonException("bad unicode escape");
                            int code = int.Parse(_s.Substring(_i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                            sb.Append((char)code);
                            _i += 4;
                            break;
                        default: throw new JsonException("bad escape \\" + e);
                    }
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }

        private JsonValue ParseNumber()
        {
            int start = _i;
            if (Peek() == '-') _i++;
            while (_i < _s.Length)
            {
                char c = _s[_i];
                if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') _i++;
                else break;
            }
            string tok = _s.Substring(start, _i - start);
            double d;
            if (!double.TryParse(tok, NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                throw new JsonException("invalid number at " + start);
            if (double.IsNaN(d) || double.IsInfinity(d))
                throw new JsonException("non-finite number at " + start);
            return new JsonValue { Kind = JsonKind.Number, NumberValue = d };
        }
    }
}
