import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './account.component.html',
  styleUrl: './account.component.css'
})
export class AccountComponent implements OnInit {
  user: User | null = null;
  failedProfileImage: string | null = null;

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    this.auth.user$.subscribe(u => this.user = u);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }

  get initials(): string {
    const name = this.user?.name || '';
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  }
}
