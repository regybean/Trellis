# Components

Components are the building block of all our pages, they contain both rendering instructions and logic to make the component do things

## Guidance

- You MUST ensure that all new components follow the styling guidelines defined in [Styling guidance](./STYLEME.md)
- Split components into their most principle parts, components should be kept short
- If a component can be generic as it is likely to be used elsewhere then do it and place in `/common`
- Anything directly related to a page should go in the appropriate `/pages` folder
- Anything in `/ui` should be shadcn generated and only modified in rare circumstances you want to globally modify a component
- It is preferable to split the functional logic into the `../hooks` folder so that the component defines only the rendering
- No .ts files are allowed in this folder, this is only for react code

## Advice

- Avoid over using useEffect, its common to be rerendering the entire page when not using it properly
  - If api requests are spamming your logs your doing something wrong
- Make sure you are aware of the virtual DOM
- Use v0 to make nice looking pages and components but ensure you follow the existing styling
- When using genAI make sure you specify that you are using the app router (not pages router)
- Most of the time you will need to write `'use client'` at the top of the page as SSR is enabled by default
- Plan out your page to define your components before rushing into coding something
