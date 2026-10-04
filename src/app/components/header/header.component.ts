import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { NavigationStart, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { filter, Observable, Subscription } from 'rxjs';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnDestroy {
  @ViewChild('menuButton') private menuButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuPanel') private menuPanel?: ElementRef<HTMLElement>;
  user$: Observable<User | null>;
  menuOpen = false;
  showProfileHint = false;
  private readonly subscriptions = new Subscription();
  private profileHintTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public cart: CartService,
    private auth: AuthService,
    private router: Router
  ) {
    this.user$ = this.auth.user$;
    this.subscriptions.add(this.user$.subscribe((user) => {
      if (user && sessionStorage.getItem('mh_show_profile_hint') === '1') {
        this.showProfileHint = true;
        if (this.profileHintTimer) clearTimeout(this.profileHintTimer);
        this.profileHintTimer = setTimeout(() => this.dismissProfileHint(), 3000);
      }
    }));
    this.subscriptions.add(this.router.events.pipe(filter((event) => event instanceof NavigationStart)).subscribe(() => {
      this.closeMenu();
    }));
    this.subscriptions.add(this.cart.previewOpen$.subscribe((isOpen) => {
      if (isOpen) this.closeMenu();
    }));
  }

  get isAdmin(): boolean {
    return this.auth.isAdmin;
  }

  dismissProfileHint(): void {
    this.showProfileHint = false;
    sessionStorage.removeItem('mh_show_profile_hint');
    if (this.profileHintTimer) {
      clearTimeout(this.profileHintTimer);
      this.profileHintTimer = undefined;
    }
  }

  toggleMenu(): void {
    if (this.menuOpen) {
      this.closeMenu(true);
      return;
    }
    this.cart.closePreview();
    this.menuOpen = true;
    this.syncScrollLock();
    setTimeout(() => this.menuPanel?.nativeElement
      .querySelector<HTMLElement>('a, button')
      ?.focus({ preventScroll: true }), 260);
  }

  closeMenu(restoreFocus = false): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.syncScrollLock();
    if (restoreFocus) setTimeout(() => this.menuButton?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  closeMenuOnEscape(): void {
    if (this.menuOpen) this.closeMenu(true);
  }

  @HostListener('window:scroll')
  @HostListener('document:wheel')
  @HostListener('document:touchmove')
  closeMenuOnPageMotion(): void {
    if (this.menuOpen) this.closeMenu();
  }

  @HostListener('window:resize')
  closeDesktopMenu(): void {
    if (window.innerWidth >= 1024 && this.menuOpen) this.closeMenu();
  }

  logout(): void {
    this.auth.logout();
    this.closeMenu();
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.menuOpen = false;
    this.syncScrollLock();
    if (this.profileHintTimer) clearTimeout(this.profileHintTimer);
  }

  private syncScrollLock(): void {
    document.body.classList.toggle('mh-scroll-locked', this.menuOpen);
  }
}
