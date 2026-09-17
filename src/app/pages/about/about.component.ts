import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MEDIA } from '../../config/media-assets';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './about.component.html',
  styleUrl: './about.component.css'
})
export class AboutComponent {
  readonly heroBg = `linear-gradient(to top, rgba(11,11,12,0.96), rgba(11,11,12,0.4)), url(${MEDIA.about.heroBg}) center/cover`;
}
