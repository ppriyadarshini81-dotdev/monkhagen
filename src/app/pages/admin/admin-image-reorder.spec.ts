import { AdminComponent } from './admin.component';

describe('Admin product image reordering', () => {
  function component(): AdminComponent {
    return new AdminComponent({} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never);
  }

  it('keeps card identities stable during native drag and moves the zoom pair on drop', () => {
    const admin = component();
    admin.form.images = 'a.webp, b.webp, c.webp';
    admin.form.zoomImages = 'a-zoom.webp, , c-zoom.webp';
    admin.ngDoCheck();
    const stablePairs = admin.imagePairs;
    const setData = jasmine.createSpy('setData');

    admin.startImageDrag(2, { dataTransfer: { effectAllowed: 'none', setData } } as unknown as DragEvent);
    admin.ngDoCheck();
    expect(admin.imagePairs).toBe(stablePairs);
    expect(setData).toHaveBeenCalledWith('text/plain', '2');

    const preventDefault = jasmine.createSpy('preventDefault');
    admin.dropImage(0, { preventDefault } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(admin.form.images).toBe('c.webp, a.webp, b.webp');
    expect(admin.form.zoomImages).toBe('c-zoom.webp, a-zoom.webp, ');
    expect(admin.imagePairs[0]).toEqual({ imageUrl: 'c.webp', zoomImageUrl: 'c-zoom.webp' });
  });
});
