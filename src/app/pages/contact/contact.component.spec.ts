import { TestBed } from '@angular/core/testing';
import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  it('shows the official email without a phone card', async () => {
    await TestBed.configureTestingModule({ imports: [ContactComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ContactComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('official@monkhagen.in');
    expect(element.textContent).not.toContain('officialmail.monkhagen@gmail.com');
    expect(element.querySelectorAll('.mh-contact__card').length).toBe(1);
    expect(element.querySelector('a[href^="tel:"]')).toBeNull();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/contact/email');
  });
});
