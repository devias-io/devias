import { type AssetUploadInput, type AssetUploadOptions, DeviasApiError } from '@devias/core';
import { errorFromResponse, type HttpClient } from './http';

const isBlob = (body: AssetUploadInput['body']): body is Blob => typeof Blob !== 'undefined' && body instanceof Blob;

/** The body a `fetch` or an `XMLHttpRequest` sends for a file. */
const bodyOf = (body: AssetUploadInput['body']): Blob | ArrayBuffer | string =>
  isBlob(body) || body instanceof ArrayBuffer || typeof body === 'string'
    ? body
    : new Blob([body as BlobPart], { type: 'application/octet-stream' });

const sizeOf = (body: AssetUploadInput['body']): number =>
  typeof body === 'string' ? new TextEncoder().encode(body).byteLength : isBlob(body) ? body.size : body.byteLength;

/**
 * Stores a file: the raw body under `name`. A browser reports progress through `XMLHttpRequest` (`fetch` cannot say
 * how much of a body has gone out); everywhere else `fetch` sends it.
 */
export const uploadAsset = async <T>(
  http: HttpClient,
  path: string,
  input: AssetUploadInput,
  options: AssetUploadOptions = {},
): Promise<T> => {
  const url = http.url(path, { name: input.name, description: input.description });
  const body = bodyOf(input.body);
  const headers = { accept: 'application/json', 'content-type': 'application/octet-stream', ...http.headers() };

  if (options.onProgress && typeof XMLHttpRequest !== 'undefined') {
    return uploadWithProgress<T>(url, body, headers, http.credentials === 'include', sizeOf(input.body), options);
  }

  let response: Response;

  try {
    response = await http.fetch(url, {
      method: 'POST',
      credentials: http.credentials,
      headers,
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    throw new DeviasApiError(0, 'NETWORK', `Network error uploading ${input.name}`, error);
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return (await response.json()) as T;
};

const uploadWithProgress = <T>(
  url: string,
  body: Blob | ArrayBuffer | string,
  headers: Record<string, string>,
  withCredentials: boolean,
  total: number,
  options: AssetUploadOptions,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.withCredentials = withCredentials;

    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : total });
    };
    request.onload = async () => {
      const response = new Response(request.responseText, { status: request.status });

      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.({ loaded: total, total });
        resolve(JSON.parse(request.responseText) as T);
      } else {
        reject(await errorFromResponse(response));
      }
    };
    request.onerror = () => reject(new DeviasApiError(0, 'NETWORK', 'Network error uploading the file'));
    request.onabort = () => reject(new DOMException('The upload was cancelled', 'AbortError'));

    if (options.signal) {
      if (options.signal.aborted) {
        request.abort();

        return;
      }

      options.signal.addEventListener('abort', () => request.abort(), { once: true });
    }

    request.send(body as XMLHttpRequestBodyInit);
  });
