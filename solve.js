// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly what the
// reference returns for {text, header} — {columns, rows, errors} — but reads
// the text with indexOf/slice fast paths instead of one character at a time.
//
// How it stays identical:
//   - A record whose line holds no quote and no stray CR is split in one go
//     (String.split on the line); every other record is read field by field.
//   - An unquoted field is sliced to the next comma, or to the line break when
//     one comes first; a stray CR anywhere in the slice falls back to the slow
//     character scan, which is the reference's own walk.
//   - A quoted field is found with indexOf('"'), doubled quotes ("") folded in,
//     and line breaks inside it (CRLF or lone CR read as LF) counted and
//     converted; a quote that never closes restarts as a literal quote plus an
//     unquoted re-read, exactly as the reference does.
//   - Errors keep the reference's order and {code, line, row}: line is the
//     1-based line the record starts on, row its index in rows (null for the
//     header); short_row/long_row carry fields:/extra: as the reference does.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  const pushError = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // The reference's own unquoted walk, used only where a fast path cannot go:
  // a stray CR inside the field, junk after a closing quote, or the re-read of
  // an unterminated quote. Scans from `pos`, updates pos/line, returns
  // [value, ended, added] where added counts the characters kept.
  function scanSlow(value) {
    let added = 0;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return [value, AT_COMMA, added];
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return [value, AT_BREAK, added];
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return [value, AT_BREAK, added];
        }
        pushError('stray_cr');
        pos += 1;
        continue;
      }
      value += text[pos];
      added += 1;
      pos += 1;
    }
    return [value, AT_END, added];
  }

  // A raw span from inside a quoted field: counts its line breaks (each CR and
  // each LF not preceded by a CR is one) onto `line`, and returns it with every
  // CRLF and lone CR read as LF. Spans without a break pass through untouched.
  function convertQuoted(raw) {
    const nl = raw.indexOf('\n');
    const cr = raw.indexOf('\r');
    if (nl === -1 && cr === -1) return raw;
    let count = 0;
    let i = -1;
    while ((i = raw.indexOf('\r', i + 1)) !== -1) count += 1;
    i = -1;
    while ((i = raw.indexOf('\n', i + 1)) !== -1) {
      if (raw.charCodeAt(i - 1) !== 13) count += 1;
    }
    line += count;
    return cr === -1 ? raw : raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  }

  // Finishes a record: sets the width from the first one, takes the header, or
  // pads/cuts a data record to the width with its short_row/long_row error.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
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

    // Fast path: a record whose line holds no quote and no stray CR. The line
    // ends at the next LF (or the end of the text); a CR is allowed only as
    // the CRLF pair that ends it.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const seg = text.slice(pos, lineEnd);
    if (seg.indexOf('"') === -1) {
      const r = seg.indexOf('\r');
      if (r === -1) {
        finishRecord(seg.split(','));
        pos = nl === -1 ? n : nl + 1;
        line += 1;
        continue;
      }
      if (r === seg.length - 1 && nl !== -1) {
        finishRecord(seg.slice(0, -1).split(','));
        pos = nl + 1;
        line += 1;
        continue;
      }
    }

    // Field by field: this record holds a quote or a stray CR.
    const fields = [];
    let ended;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        // A quoted field: find its closing quote, folding doubled quotes.
        quoted = true;
        const open = pos;
        const openLine = line;
        let value = '';
        let scan = pos + 1;
        let closed = -1;
        for (;;) {
          const q = text.indexOf('"', scan);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            value += convertQuoted(text.slice(scan, q)) + '"';
            scan = q + 2;
            continue;
          }
          closed = q;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          pushError('unterminated_quote');
          const slow = scanSlow('"');
          fields.push(slow[0]);
          ended = slow[1];
          continue;
        }
        value += convertQuoted(text.slice(scan, closed));
        pos = closed + 1;
        if (pos >= n) {
          ended = AT_END;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            ended = AT_COMMA;
          } else if (c === 10) {
            pos += 1;
            line += 1;
            ended = AT_BREAK;
          } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            ended = AT_BREAK;
          } else {
            // What follows the closing quote is appended as it stands, up to
            // the next comma or line break.
            const slow = scanSlow(value);
            value = slow[0];
            ended = slow[1];
            if (slow[2] > 0) pushError('quote_junk');
          }
        }
        fields.push(value);
      } else {
        // An unquoted field: slice to the next comma, or to the line break
        // when one comes first; a stray CR in the slice takes the slow walk.
        // An empty field (comma, line break or CRLF right at the start) skips
        // the slice and the scans entirely.
        quoted = false;
        const first = text.charCodeAt(pos);
        if (first === 44) {
          fields.push('');
          pos += 1;
          ended = AT_COMMA;
        } else if (first === 10) {
          fields.push('');
          pos += 1;
          line += 1;
          ended = AT_BREAK;
        } else if (first === 13 && text.charCodeAt(pos + 1) === 10) {
          fields.push('');
          pos += 2;
          line += 1;
          ended = AT_BREAK;
        } else if (first === 13 || first !== first) {
          // A lone CR at the start, or the end of the text: the slow walk.
          const slow = scanSlow('');
          fields.push(slow[0]);
          ended = slow[1];
        } else {
          const comma = text.indexOf(',', pos);
          const end = comma === -1 ? n : comma;
          const part = text.slice(pos, end);
          const brk = part.indexOf('\n');
          if (brk !== -1) {
            const raw = part.slice(0, brk);
            const r = raw.indexOf('\r');
            if (r === -1) {
              fields.push(raw);
              pos += brk + 1;
              line += 1;
              ended = AT_BREAK;
            } else if (r === raw.length - 1) {
              fields.push(raw.slice(0, -1));
              pos += brk + 1;
              line += 1;
              ended = AT_BREAK;
            } else {
              const slow = scanSlow('');
              fields.push(slow[0]);
              ended = slow[1];
            }
          } else if (comma !== -1) {
            if (part.indexOf('\r') === -1) {
              fields.push(part);
              pos = comma + 1;
              ended = AT_COMMA;
            } else {
              const slow = scanSlow('');
              fields.push(slow[0]);
              ended = slow[1];
            }
          } else if (part.indexOf('\r') === -1) {
            fields.push(part);
            pos = n;
            ended = AT_END;
          } else {
            const slow = scanSlow('');
            fields.push(slow[0]);
            ended = slow[1];
          }
        }
      }
    } while (ended === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
