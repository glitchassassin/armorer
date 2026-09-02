const DATABASE_NAME = 'armorer-offline-v2';
const DATABASE_VERSION = 1;

export type StoreName = 'meta' | 'chapters' | 'search';

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      if (!database.objectStoreNames.contains('chapters')) database.createObjectStore('chapters');
      if (!database.objectStoreNames.contains('search')) database.createObjectStore('search');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline storage'));
    request.onblocked = () => reject(new Error('Offline storage upgrade was blocked'));
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'));
  });
}

export async function getValue<T>(database: IDBDatabase, store: StoreName, key: IDBValidKey) {
  return requestResult<T | undefined>(database.transaction(store).objectStore(store).get(key));
}

export async function hasValue(database: IDBDatabase, store: StoreName, key: IDBValidKey) {
  const result = await requestResult(database.transaction(store).objectStore(store).count(key));
  return result > 0;
}

export function putValue<T>(database: IDBDatabase, store: StoreName, key: IDBValidKey, value: T) {
  return requestResult(database.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export function deleteValue(database: IDBDatabase, store: StoreName, key: IDBValidKey) {
  return requestResult(database.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export function getAllKeys(database: IDBDatabase, store: StoreName) {
  return requestResult(database.transaction(store).objectStore(store).getAllKeys());
}

export function writeMetaAtomically(database: IDBDatabase, values: Record<string, unknown>) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('meta', 'readwrite');
    const store = transaction.objectStore('meta');
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) store.delete(key);
      else store.put(value, key);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to activate offline content'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline content activation was aborted'));
  });
}

export { DATABASE_NAME };
