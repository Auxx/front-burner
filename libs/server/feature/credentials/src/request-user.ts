import { NotFoundException } from '@nestjs/common';

/** A positive integer route ID; anything else is the `404` of an unknown ID (AR-56). */
export function parseId(text: string): number {
  if (!/^[1-9]\d{0,14}$/.test(text)) {
    throw new NotFoundException();
  }
  return Number(text);
}
