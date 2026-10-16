// web-ifc bounds individual strings; a large Prosota links JSON can exceed that buffer.
// Read text property values from STEP without imposing that limit. Geometry stays in web-ifc.
export function readStepTextProperties(text: string): Map<number, string> {
    const result = new Map<number, string>();
    const records = /#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\s*\(/gi;
    for (let match; (match = records.exec(text));) {
        const args: string[] = [];
        let depth = 0, quoted = false, start = records.lastIndex, end = start;
        for (; end < text.length; end++) {
            const c = text[end];
            if (c === "'") {
                if (quoted && text[end + 1] === "'") {
                    end++;
                    continue;
                }
                quoted = !quoted;
                continue;
            }
            if (quoted)
                continue;
            if (c === '(')
                depth++;
            else if (c === ')') {
                if (depth === 0) {
                    args.push(text.slice(start, end).trim());
                    break;
                }
                depth--;
            }
            else if (c === ',' && depth === 0) {
                args.push(text.slice(start, end).trim());
                start = end + 1;
            }
        }
        records.lastIndex = end + 1;
        const value = args[2];
        if (!value)
            continue;
        const prefix = /^IFC(?:TEXT|LABEL|IDENTIFIER)\s*\(\s*'/i.exec(value);
        if (!prefix || !/'\s*\)$/.test(value))
            continue;
        const encoded = value.slice(prefix[0].length, value.lastIndexOf("'"));
        result.set(Number(match[1]), decodeStepString(encoded));
    }
    return result;
}
export function decodeStepString(value: string): string {
    let decoded = '';
    for (let i = 0; i < value.length;) {
        if (value[i] === "'" && value[i + 1] === "'") {
            decoded += "'";
            i += 2;
            continue;
        }
        if (value[i] === '\\') {
            if (value[i + 1] === '\\') {
                decoded += '\\';
                i += 2;
                continue;
            }
            if (value.slice(i, i + 4) === '\\X2\\' || value.slice(i, i + 4) === '\\X4\\') {
                const width = value[i + 2] === '2' ? 4 : 8, end = value.indexOf('\\X0\\', i + 4);
                if (end < 0)
                    throw new Error('Invalid STEP text escape.');
                const hex = value.slice(i + 4, end);
                if (hex.length % width || !/^[\da-f]*$/i.test(hex))
                    throw new Error('Invalid STEP text escape.');
                for (let j = 0; j < hex.length; j += width)
                    decoded += String.fromCodePoint(parseInt(hex.slice(j, j + width), 16));
                i = end + 4;
                continue;
            }
        }
        decoded += value[i++];
    }
    return decoded;
}
