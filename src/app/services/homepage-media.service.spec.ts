import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_HOMEPAGE_MEDIA } from '../models/homepage-media.model';
import { HomepageMediaService } from './homepage-media.service';

describe('Homepage media API', () => {
  let service: HomepageMediaService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(HomepageMediaService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('loads fresh settings and includes the revision when saving', () => {
    service.getContent().subscribe();
    http.expectOne('/api/homepage-media').flush(DEFAULT_HOMEPAGE_MEDIA);
    service.saveContent({ ...DEFAULT_HOMEPAGE_MEDIA, revision: 4 }).subscribe();
    const request = http.expectOne('/api/homepage-media');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.revision).toBe(4);
    request.flush({ ...DEFAULT_HOMEPAGE_MEDIA, revision: 5 });
  });

  it('uses existing authenticated image and video upload contracts with the correct folders', () => {
    const image = new File(['image'], 'image.webp', { type: 'image/webp' });
    service.upload([image], 'image').subscribe();
    const images = http.expectOne('/api/upload?folder=banners');
    expect((images.request.body as FormData).getAll('images').length).toBe(1);
    images.flush({ urls: ['https://media.example/new.webp'] });
    service.upload([new File(['video'], 'ad.mp4', { type: 'video/mp4' })], 'video').subscribe();
    http.expectOne('/api/upload?folder=videos').flush({ urls: ['https://media.example/new.mp4'] });
  });
});
