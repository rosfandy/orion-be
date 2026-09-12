import type { Response } from 'express';

export type ApiResponse<T> = {
  success: boolean;
  data: T;
  message: string;
};

function Success<T>(response: Response, statusCode: number, data: T, message: string): Response {
  response.status(statusCode).json({ success: true, data, message } satisfies ApiResponse<T>);
  return response;
}

function Error<T = null>(response: Response, statusCode: number, message: string, data: T = null as T): Response {
  response.status(statusCode).json({ success: false, data, message } satisfies ApiResponse<T>);
  return response;
}

export const presenter = { Success, Error };
