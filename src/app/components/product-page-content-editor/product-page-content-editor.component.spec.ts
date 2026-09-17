import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgForm } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { ProductPageContent } from '../../models/product-page-content.model';
import { ProductPageContentService } from '../../services/product-page-content.service';
import { UploadService } from '../../services/upload.service';
import { ProductPageContentEditorComponent } from './product-page-content-editor.component';

describe('Product page content editor', () => {
  let fixture: ComponentFixture<ProductPageContentEditorComponent>;
  let component: ProductPageContentEditorComponent;
  let service: jasmine.SpyObj<ProductPageContentService>;
  let uploads: jasmine.SpyObj<UploadService>;
  const stored: ProductPageContent = {
    sizeChartImageUrl: '', careInstructions: '', deliveryEstimate: '3–5 days', deliveryNote: 'Test delivery note'
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj('ProductPageContentService', ['getContent', 'saveContent']);
    uploads = jasmine.createSpyObj('UploadService', ['uploadImages']);
    service.getContent.and.returnValue(of({ ...stored }));
    service.saveContent.and.callFake(content => of({ ...content }));
    await TestBed.configureTestingModule({ imports: [ProductPageContentEditorComponent], providers: [
      { provide: ProductPageContentService, useValue: service }, { provide: UploadService, useValue: uploads }
    ] }).compileComponents();
    fixture = TestBed.createComponent(ProductPageContentEditorComponent);
    component = fixture.componentInstance;
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function form(): NgForm {
    return fixture.debugElement.query(By.directive(NgForm)).injector.get(NgForm);
  }

  it('loads delivery information from the API, not frontend defaults', async () => {
    await render();
    expect(fixture.nativeElement.querySelector('#delivery-estimate').value).toBe('3–5 days');
    expect(component.content?.careInstructions).toBe('');
    expect(service.getContent).toHaveBeenCalledTimes(1);
  });

  it('saves edited shared content and marks the form pristine', async () => {
    await render();
    component.content!.careInstructions = 'Wash cold.\nDry flat.';
    await render();
    component.save(form());
    await render();
    expect(service.saveContent).toHaveBeenCalledWith(jasmine.objectContaining({ careInstructions: 'Wash cold.\nDry flat.' }));
    expect(component.saving).toBeFalse();
    expect(form().pristine).toBeTrue();
    expect(component.message).toContain('shared across all product pages');
  });

  it('rejects unsafe image URLs and a whitespace-only delivery estimate', async () => {
    await render();
    component.content!.sizeChartImageUrl = 'javascript:alert(1)';
    component.save(form());
    expect(service.saveContent).not.toHaveBeenCalled();
    component.content!.sizeChartImageUrl = '';
    component.content!.deliveryEstimate = '   ';
    component.save(form());
    expect(service.saveContent).not.toHaveBeenCalled();
  });

  it('restores the saved values when discarding changes', async () => {
    await render();
    component.content!.careInstructions = 'Unsaved instructions';
    component.discard(form());
    expect(component.content).toEqual(stored);
    expect(service.saveContent).not.toHaveBeenCalled();
  });

  it('preserves unsaved edits if saving fails', async () => {
    await render();
    service.saveContent.and.returnValue(throwError(() => new Error('offline')));
    component.content!.careInstructions = 'Keep these edits';
    component.save(form());
    expect(component.content?.careInstructions).toBe('Keep these edits');
    expect(component.error).toContain('Your changes are still here');
    expect(component.saving).toBeFalse();
  });

  it('does not show a blank editable form when initial loading fails', async () => {
    service.getContent.and.returnValue(throwError(() => new Error('offline')));
    await render();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(component.content).toBeUndefined();
    service.getContent.and.returnValue(of({ ...stored }));
    component.loadContent();
    await render();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('uploads the chart using R2 and waits for Save before publishing it', async () => {
    await render();
    const pending = new Subject<{ urls: string[] }>();
    uploads.uploadImages.and.returnValue(pending);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[type="file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['image'], 'chart.webp', { type: 'image/webp' }));
    input.files = transfer.files;
    component.uploadSizeChart({ target: input } as unknown as Event);
    component.save(form());
    expect(service.saveContent).not.toHaveBeenCalled();
    pending.next({ urls: ['https://example.com/chart.webp'] });
    pending.complete();
    expect(component.content?.sizeChartImageUrl).toBe('https://example.com/chart.webp');
    expect(component.uploading).toBeFalse();
    expect(service.saveContent).not.toHaveBeenCalled();
  });
});
