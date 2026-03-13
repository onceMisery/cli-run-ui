import fs from 'node:fs';
import readline from 'node:readline';
export async function readLinesFromOffset(filePath, fromOffset) {
    const lines = [];
    let bytesConsumed = 0;
    const stream = fs.createReadStream(filePath, { start: fromOffset });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (line.length === 0)
            continue;
        lines.push(line);
        bytesConsumed += Buffer.byteLength(line) + 1;
    }
    rl.close();
    stream.close();
    return { lines, nextOffset: fromOffset + bytesConsumed };
}
export async function readAllLines(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
//# sourceMappingURL=stream.js.map