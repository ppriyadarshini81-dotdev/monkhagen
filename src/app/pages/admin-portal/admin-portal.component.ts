import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-admin-portal', standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin-portal.component.html', styleUrl: './admin-portal.component.css'
})
export class AdminPortalComponent {
  constructor(private router: Router) {}
  get productsActive(): boolean { return this.router.url.startsWith('/admin/products'); }
}
