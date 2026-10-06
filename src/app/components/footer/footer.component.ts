import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css'
})
export class FooterComponent {
  year = new Date().getFullYear();
  constructor(private auth: AuthService) {}

  get accountLink(): string {
    return this.auth.isLoggedIn ? '/account/profile' : '/login';
  }
}
