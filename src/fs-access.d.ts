// File System Access API pieces not yet in TypeScript's DOM lib (Chromium only).
interface FileSystemHandlePermissionDescriptor { mode?: 'read' | 'readwrite' }
interface FileSystemHandle {
  queryPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}
interface Window {
  showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}
