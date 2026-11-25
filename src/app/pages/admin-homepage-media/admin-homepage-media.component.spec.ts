import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { HomepageMediaService } from '../../services/homepage-media.service';
import { DEFAULT_HOMEPAGE_MEDIA, HomepageMedia } from '../../models/homepage-media.model';
import { AdminHomepageMediaComponent } from './admin-homepage-media.component';

describe('Admin homepage media editor', () => {
  let api: jasmine.SpyObj<HomepageMediaService>;
  const fresh = (): HomepageMedia => JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_MEDIA));
  beforeEach(() => {
    api = jasmine.createSpyObj('HomepageMediaService', ['getContent', 'saveContent', 'upload']);
    api.getContent.and.returnValue(of(fresh()));
    TestBed.configureTestingModule({ providers: [{ provide: HomepageMediaService, useValue: api }] });
  });

  it('renders all three sections, supports ordering and publishes the edited values together', async () => {
    const fixture = TestBed.createComponent(AdminHomepageMediaComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('h2')).map(heading => heading.textContent))
      .toEqual(['Home header pictures', 'Ad video', 'Instagram pictures']);
    expect(component.dirty).toBeFalse();
    const originalFirst = component.content!.heroImages[0].src;
    component.move(component.content!.heroImages, 0, 1);
    expect(component.content!.heroImages[1].src).toBe(originalFirst);
    component.content!.adVideoUrl = 'https://media.example/new.mp4';
    component.content!.instagramPosts.splice(0, 1);
    expect(component.dirty).toBeTrue();
    api.saveContent.and.callFake(content => of({ ...content, revision: 1 }));
    component.save();
    expect(api.saveContent).toHaveBeenCalledOnceWith(jasmine.objectContaining({ adVideoUrl: 'https://media.example/new.mp4', revision: 0 }));
    expect(component.content!.revision).toBe(1);
    expect(component.dirty).toBeFalse();
    expect(component.message).toContain('saved');
    fixture.destroy();
  });

  it('uploads a replacement into the draft and never publishes until Save is clicked', () => {
    const component = new AdminHomepageMediaComponent(api);
    component.ngOnInit();
    const result = new Subject<{ urls: string[] }>();
    api.upload.and.returnValue(result);
    const file = new File(['image'], 'new.webp', { type: 'image/webp' });
    component.upload({ target: { files: [file], value: 'new.webp' } } as unknown as Event, 'hero', 'image', 0);
    expect(component.uploading).toBeTrue();
    expect(api.saveContent).not.toHaveBeenCalled();
    result.next({ urls: ['https://media.example/replacement.webp'] });
    expect(component.content!.heroImages[0].src).toBe('https://media.example/replacement.webp');
    expect(component.dirty).toBeTrue();
    expect(component.uploading).toBeFalse();
    expect(api.saveContent).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('preserves drafts on save errors and tells the admin about stale revisions', () => {
    const component = new AdminHomepageMediaComponent(api);
    component.ngOnInit();
    component.content!.heroImages[0].alt = 'Unsaved caption';
    api.saveContent.and.returnValue(throwError(() => ({ status: 409 })));
    component.save();
    expect(component.content!.heroImages[0].alt).toBe('Unsaved caption');
    expect(component.dirty).toBeTrue();
    expect(component.saving).toBeFalse();
    expect(component.error).toContain('Another administrator');
    component.ngOnDestroy();
  });

  it('rejects invalid files and protects the final header image', () => {
    const component = new AdminHomepageMediaComponent(api);
    component.ngOnInit();
    component.content!.heroImages = [component.content!.heroImages[0]];
    component.remove(component.content!.heroImages, 0);
    expect(component.content!.heroImages.length).toBe(1);
    const file = new File(['<svg>'], 'unsafe.svg', { type: 'image/svg+xml' });
    component.upload({ target: { files: [file], value: 'unsafe.svg' } } as unknown as Event, 'hero', 'image');
    expect(api.upload).not.toHaveBeenCalled();
    expect(component.error).toContain('JPG');
    component.content!.heroImages[0].src = '';
    component.save();
    expect(api.saveContent).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
});
