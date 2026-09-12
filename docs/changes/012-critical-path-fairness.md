# PR 012 — Critical path and portfolio fairness

Adds downstream critical-path depth scoring and portfolio concentration fairness penalties. Upstream tasks that unlock deeper dependency chains receive more scheduler weight, while repositories/products already consuming multiple active lanes receive a soft penalty so spare capacity redistributes across the portfolio.

Portfolio Scheduler and Dynamic Lanes advances from 55% to 70%.
