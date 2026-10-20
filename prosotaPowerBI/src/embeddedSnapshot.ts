// Offline report handoff: no local HTTP listener, credentials or filesystem API.
export async function embeddedSnapshot(payload: string, name: string): Promise<File> {
    if (payload.length > 360 * 1024 * 1024)
        throw new Error('Embedded IFC exceeds the 256 MB preview limit.');
    const binary = atob(payload);
    const compressed = Uint8Array.from(binary, c => c.charCodeAt(0));
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (size > 256 * 1024 * 1024) throw new Error('Embedded IFC exceeds the 256 MB preview limit.');
            chunks.push(next.value);
        }
    } finally {
        await reader.cancel();
    }
    return new File(chunks, name || 'Prosota.ifc', { type: 'application/x-step' });
}
