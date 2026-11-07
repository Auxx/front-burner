I want to align Angular templates with the best practices and add a skill which
will guide the Agent when working with the templates in the future.

Do you agree that the following rules improve the code quality of the product?
And how should we approach refactoring? I believe additional tests should be
added to validate that such refactoring hasn't broken anything.

Also are there any other issues with Angular HTML templates I am missing?

## 1. Signals inside templates

Each time a signal is used inside a template a new dependency (subscription)
is created to track changes. It is better to read signal value once, either
at the start of the template or at the start of a block like `<ng-template>`
which creates its own context.

### Bad approach:

```html

<ul>
  @for (item of items(); track item.id) {
  <li>
    {{ item.name }}
    @if(enabled()) {
    <span>Enabled</span>
    }
  </li>
  }
</ul>
```

### Good approach:

```html
@let itemsList = items();
@let isEnabled = enabled();

<ul>
  @for (item of itemsList; track item.id) {
  <li>
    {{ item.name }}
    @if(isEnabled) {
    <span>Enabled</span>
    }
  </li>
  }
</ul>
```

## 2. Two-way bindings should be avoided

It is a better practice to use one-way bindings to pass data between components.
It is easier to reason about how the data flows across the application when
one-way bindings are used. Two-way bindings also tend to lead to unexpected side
effects

### Bad approach:

```html

<some-component [(selected)]="selectedModel"/>
```

### Good approach:

```html

<some-component [selected]="selected"
                (selectionChanged)="updateSelection()"/>
```

## 3. Avoid method and function calls

Templates should not call class methods and functions to format or acquire data.
Angular pipes should be used for formatting. And data should be acquired and
prepared in a correct format inside the component code. Method calls should only
be used as event handlers.

### Bad approach:

```html
@let item = getItem(id);
<div>
  {{ grams(item.weight) }}
</div>
```

### Good approach:

```html

<div>
  {{ item.weight | grams }}
</div>
```

## Optional - HTML formatting

`dprint` is used to format most code, but it cannot format Angular HTML
templates. Existing `dprint` plugins have bugs which don't fully support Angular
expressions and break templates. It would be great to let Agents format HTML as
a temporary solution if possible.

The way HTML is formatted right now is mostly correct, the only thing I would
change is the way attributes are positioned.

- If HTML tag has only one attribute, then it should be on the same line as tag.
- If HTML tag has multiple attributes, then the first one should be on the same
  line as tag, every other attribute should be on a separate line and aligned
  with the first attribute. Last attribute should be followed by closing bracket
  on the same line.

### Bad approach:

```html

<button
  uiButton
  variant="ghost"
  size="small"
  class="how"
>
```

### Good approach:

```html

<button uiButton
        variant="ghost"
        size="small"
        class="how">
```
