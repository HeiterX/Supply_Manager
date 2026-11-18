import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@Injectable()
export class PublicUploadTokenGuard implements CanActivate {
  constructor(private readonly requests: PurchaseRequestsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.requests.assertPublicUploadToken(
      String(request.params.requestId),
      request.get('X-Upload-Token'),
    );
    return true;
  }
}
