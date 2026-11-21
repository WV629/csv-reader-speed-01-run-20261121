// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
//
// Returns exactly csv-reader 1.0.0's answer {columns, rows, errors} for every
// input {text, header}, but reads the text with indexOf jumps and sliced
// fields instead of one character at a time:
//
// - An unquoted field is the slice up to the next comma or line break. The
//   next line break is cached across a record's fields (it only moves when
//   a field ends), so a field costs one indexOf for its comma and one slice.
//   A stray CR inside a field is the only reason to fall back to the
//   reference's character loop, and a whole-file pre-scan proves most files
//   have none, so the common path never looks for one.
// - A quoted field jumps from quote to quote with indexOf; a segment
//   between quotes is one slice unless it holds a line break, in which case
//   CRLF and lone CRs inside it are read as LF and the lines counted,
//   exactly as the reference does.
// - Line numbers are kept exactly as the reference keeps them: every LF,
//   CRLF and lone CR inside quotes counts once, every record's errors
//   carry the line its record starts on.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Whether any CR is not followed by LF. With none, an unquoted field can
  // hold a CR only as the last character before its LF line break, and a
  // quoted segment can hold one only as half of a CRLF, so the common path
  // never searches a field for one.
  let strayCR = false;
  {
    let i = text.indexOf('\r', 0);
    while (i !== -1) {
      if (text.charCodeAt(i + 1) !== 10) {
        strayCR = true;
        break;
      }
      i = text.indexOf('\r', i + 1);
    }
  }

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The next LF / CR at or after the last position they were searched from:
  // recomputed whenever the scan has passed them. The next LF only moves
  // when a line break is consumed, so a record's unquoted fields share one
  // search for it.
  let nextNl = -1;
  let nextCr = -1;

  // The field just read: how it ended and how many characters were kept.
  let fEnded = END;
  let fAdded = 0;

  // The segment text[a..b) appended to `value`, with each CRLF or lone CR
  // inside it read as LF and the lines counted, as the reference reads them.
  function appendSeg(value, a, b) {
    if (nextNl < a) nextNl = text.indexOf('\n', a);
    if (nextNl === -1 || nextNl >= b) {
      if (!strayCR) return value + text.slice(a, b);
      if (nextCr < a) nextCr = text.indexOf('\r', a);
      if (nextCr === -1 || nextCr >= b) return value + text.slice(a, b);
    }
    let s = value;
    let p = a;
    while (p < b) {
      const ch = text.charCodeAt(p);
      if (ch === 13) {
        s += '\n';
        line += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
      } else {
        if (ch === 10) line += 1;
        s += text[p];
        p += 1;
      }
    }
    return s;
  }

  // The reference's character loop for an unquoted field that holds a stray
  // CR, from `start` onto `value` (`added` characters kept so far). Sets
  // fEnded/fAdded and returns the field.
  function readUnquotedSlow(start, value, added) {
    let p = start;
    let v = value;
    let a = added;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        p += 1;
        pos = p;
        fEnded = COMMA;
        fAdded = a;
        return v;
      }
      if (c === 10) {
        p += 1;
        line += 1;
        pos = p;
        fEnded = LINE_BREAK;
        fAdded = a;
        return v;
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          p += 2;
          line += 1;
          pos = p;
          fEnded = LINE_BREAK;
          fAdded = a;
          return v;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        p += 1;
        continue;
      }
      v += text[p];
      a += 1;
      p += 1;
    }
    pos = p;
    fEnded = END;
    fAdded = a;
    return v;
  }

  // Reads unquoted characters onto `init` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fEnded/fAdded and
  // returns the field. Only used where the field does not start a record's
  // hot path (after a closing quote, or after an unterminated one).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    const start = pos;
    if (nextNl < start) nextNl = text.indexOf('\n', start);
    const comma = text.indexOf(',', start);
    let end;
    let ended;
    if (comma !== -1 && (nextNl === -1 || comma < nextNl)) {
      end = comma;
      ended = COMMA;
    } else if (nextNl !== -1) {
      end = nextNl;
      ended = LINE_BREAK;
    } else {
      end = n;
      ended = END;
    }
    if (strayCR) {
      if (nextCr < start) nextCr = text.indexOf('\r', start);
      if (nextCr !== -1 && nextCr < end) {
        if (ended === LINE_BREAK && nextCr === end - 1) {
          value += text.slice(start, end - 1);
          added += end - 1 - start;
          pos = end + 1;
          line += 1;
          fEnded = ended;
          fAdded = added;
          return value;
        }
        return readUnquotedSlow(start, value, added);
      }
    }
    if (ended === LINE_BREAK && end > start && text.charCodeAt(end - 1) === 13) {
      value += text.slice(start, end - 1);
      added += end - 1 - start;
      pos = end + 1;
      line += 1;
      fEnded = ended;
      fAdded = added;
      return value;
    }
    value += text.slice(start, end);
    added += end - start;
    if (ended === COMMA) pos = end + 1;
    else if (ended === LINE_BREAK) {
      pos = end + 1;
      line += 1;
    } else pos = end;
    fEnded = ended;
    fAdded = added;
    return value;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fEnded and
  // returns the field.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let seg = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        value = appendSeg(value, seg, q) + '"';
        pos = q + 2;
        seg = pos;
        continue;
      }
      value = appendSeg(value, seg, q);
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let value;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        value = readQuoted();
      } else {
        // The hot path: an unquoted field is the slice up to the next comma
        // or line break (the line break is cached across the record).
        const start = pos;
        if (nextNl < start) nextNl = text.indexOf('\n', start);
        const comma = text.indexOf(',', start);
        let end;
        let ended;
        if (comma !== -1 && (nextNl === -1 || comma < nextNl)) {
          end = comma;
          ended = COMMA;
        } else if (nextNl !== -1) {
          end = nextNl;
          ended = LINE_BREAK;
        } else {
          end = n;
          ended = END;
        }
        if (strayCR) {
          if (nextCr < start) nextCr = text.indexOf('\r', start);
          if (nextCr !== -1 && nextCr < end) {
            if (ended === LINE_BREAK && nextCr === end - 1) {
              value = text.slice(start, end - 1);
              pos = end + 1;
              line += 1;
              fEnded = ended;
              fields.push(value);
              continue;
            }
            value = readUnquotedSlow(start, '', 0);
            fields.push(value);
            continue;
          }
        }
        if (ended === LINE_BREAK && end > start && text.charCodeAt(end - 1) === 13) {
          value = text.slice(start, end - 1);
          pos = end + 1;
          line += 1;
          fEnded = ended;
          fields.push(value);
          continue;
        }
        value = text.slice(start, end);
        if (ended === COMMA) pos = end + 1;
        else if (ended === LINE_BREAK) {
          pos = end + 1;
          line += 1;
        } else pos = end;
        fEnded = ended;
        fields.push(value);
        continue;
      }
      fields.push(value);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
