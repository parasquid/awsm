import { browser } from "wxt/browser";
import type { RuntimeErrorId } from "../domain/contracts";
import type { AppRequestV1, AppResponseV1 } from "./protocol";

export class AppClientError extends Error {
  readonly id: RuntimeErrorId;

  constructor(id: RuntimeErrorId, message: string) {
    super(message);
    this.name = "AppClientError";
    this.id = id;
  }
}

export async function sendRequest<T>(request: AppRequestV1): Promise<T> {
  const response: AppResponseV1 = await browser.runtime.sendMessage(request);
  if (!response.ok) throw new AppClientError(response.error.id, response.error.message);
  return response.value as T;
}
