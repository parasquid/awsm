import { DATABASE_VERSION, STORES } from "./schema";

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError")),
      { once: true },
    );
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export function abortTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
  }
}

export function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        for (const storeName of Object.values(STORES)) {
          database.createObjectStore(storeName);
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Database opening blocked")), {
      once: true,
    });
  });
}

export async function deleteDatabase(name: string, database: IDBDatabase): Promise<void> {
  database.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Database deletion blocked")), {
      once: true,
    });
  });
}
