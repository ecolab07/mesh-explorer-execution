export interface MeshNotesServerOptions {
    storageDir: string;
    graphSpaceId?: string;
    host?: string;
    port?: number;
}
export interface MeshNotesServerHandle {
    url: string;
    port: number;
    close: () => Promise<void>;
}
export declare function startMeshNotesServer(options: MeshNotesServerOptions): Promise<MeshNotesServerHandle>;
