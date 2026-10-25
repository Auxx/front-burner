/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { HealthStatus } from '@front-burner/shared-contracts';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HealthApi {
  private readonly http = inject(HttpClient);

  live(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`/api/health/live`);
  }
  ready(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`/api/health/ready`);
  }
}
