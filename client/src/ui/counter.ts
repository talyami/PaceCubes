/** CSS split-flap / flip counter for own count. */

export class FlipCounter {
  readonly el: HTMLElement;
  private value = 0;
  private d0: HTMLElement;
  private d1: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "flip-counter";
    this.d0 = this.digitEl();
    this.d1 = this.digitEl();
    this.el.append(this.d0, this.d1);
    this.render(0, false);
  }

  private digitEl(): HTMLElement {
    const d = document.createElement("div");
    d.className = "flip-digit";
    const card = document.createElement("div");
    card.className = "card top";
    card.textContent = "0";
    d.append(card);
    return d;
  }

  set(n: number, animate = true): void {
    n = Math.max(0, Math.min(99, n | 0));
    if (n === this.value) return;
    this.render(n, animate);
    this.value = n;
  }

  get(): number {
    return this.value;
  }

  private render(n: number, animate: boolean): void {
    const s = n.toString().padStart(2, "0");
    this.setDigit(this.d0, s[0]!, animate);
    this.setDigit(this.d1, s[1]!, animate && s[1] !== String(this.value).padStart(2, "0")[1]);
  }

  private setDigit(el: HTMLElement, ch: string, animate: boolean): void {
    const card = el.querySelector(".card") as HTMLElement;
    if (card.textContent === ch) return;
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.remove("flip");
      void el.offsetWidth;
      el.classList.add("flip");
      setTimeout(() => {
        card.textContent = ch;
        el.classList.remove("flip");
      }, 60);
    } else {
      card.textContent = ch;
    }
  }

  showLocked(n: number): void {
    this.el.innerHTML = "";
    this.el.className = "locked-numeral";
    this.el.textContent = String(n);
    this.value = n;
  }

  resetFlip(): void {
    this.el.className = "flip-counter";
    this.el.innerHTML = "";
    this.d0 = this.digitEl();
    this.d1 = this.digitEl();
    this.el.append(this.d0, this.d1);
    this.value = -1;
    this.set(0, false);
  }
}
