import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { Observable, Subscription } from 'rxjs';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})
export class HeaderComponent implements OnDestroy {
  user$: Observable<User | null>;
  menuOpen = false;
  showProfileHint = false;
  private readonly userSubscription: Subscription;
  private profileHintTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public cart: CartService,
    private auth: AuthService,
    private router: Router
  ) {
    this.user$ = this.auth.user$;
    this.userSubscription = this.user$.subscribe((user) => {
      if (user && sessionStorage.getItem('mh_show_profile_hint') === '1') {
        this.showProfileHint = true;
        if (this.profileHintTimer) clearTimeout(this.profileHintTimer);
        this.profileHintTimer = setTimeout(() => this.dismissProfileHint(), 3000);
      }
    });
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
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  logout(): void {
    this.auth.logout();
    this.closeMenu();
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
    if (this.profileHintTimer) clearTimeout(this.profileHintTimer);
  }
}
