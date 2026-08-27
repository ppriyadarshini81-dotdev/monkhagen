import { Component } from '@angular/core';

@Component({
  selector: 'app-contact',
  standalone: true,
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.css'
})
export class ContactComponent {
  readonly email = 'officialmail.monkhagen@gmail.com';
  readonly phone = '12345678678';
}
