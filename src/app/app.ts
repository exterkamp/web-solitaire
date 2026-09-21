import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// The shell, which is a router outlet and nothing else.
//
// Nothing sits outside a page in this game. In Nertz the corner holds who you
// are signed in as; here there is nobody to be, which is most of the point -
// see README.md.
@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {}
