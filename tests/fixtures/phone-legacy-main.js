// ============================================================================
// Main site interactions shared across the public pages.
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {

    // Mobile navigation toggle.
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.getElementById('navLinks');

    // Build the Airport Transfer route submenu from the shared navigation link.
    // Keeping this in the shared script applies the same hierarchy to every public page.
    if (navLinks) {
        const airportLink = navLinks.querySelector(
            '.nav-dropdown-menu > li > a[href="/airport"], ' +
            '.nav-dropdown-menu > li > a[href$="airport-transfer.html"]'
        );

        if (airportLink) {
            const airportItem = airportLink.parentElement;
            const airportToggle = document.createElement('div');
            const airportButton = document.createElement('button');
            const airportMenu = document.createElement('ul');
            const cdgParisItem = document.createElement('li');
            const cdgParisLink = document.createElement('a');
            const orlyParisItem = document.createElement('li');
            const orlyParisLink = document.createElement('a');
            const beauvaisParisItem = document.createElement('li');
            const beauvaisParisLink = document.createElement('a');

            airportItem.classList.add('nav-subdropdown');
            airportToggle.className = 'nav-subdropdown-toggle';
            airportButton.type = 'button';
            airportButton.className = 'nav-subdropdown-btn';
            airportButton.setAttribute('aria-label', 'Open Airport Transfer pages');
            airportButton.setAttribute('aria-expanded', 'false');
            airportButton.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            airportMenu.className = 'nav-subdropdown-menu';
            const airportHref = airportLink.getAttribute('href');
            const usesCleanUrls = airportHref === '/airport';
            const pathPrefix = usesCleanUrls
                ? '/'
                : airportHref.slice(0, -'airport-transfer.html'.length);
            const pageSuffix = usesCleanUrls ? '' : '.html';
            cdgParisLink.href = pathPrefix + 'cdg-to-paris' + pageSuffix;
            cdgParisLink.textContent = 'CDG to Paris';
            orlyParisLink.href = pathPrefix + 'orly-to-paris' + pageSuffix;
            orlyParisLink.textContent = 'Orly to Paris';
            beauvaisParisLink.href = pathPrefix + 'beauvais-to-paris' + pageSuffix;
            beauvaisParisLink.textContent = 'Beauvais to Paris';

            if (document.body.classList.contains('cdg-paris-page')) {
                cdgParisLink.classList.add('active');
            }

            if (document.body.classList.contains('orly-paris-page')) {
                orlyParisLink.classList.add('active');
            }

            if (document.body.classList.contains('beauvais-paris-page')) {
                beauvaisParisLink.classList.add('active');
            }

            airportItem.insertBefore(airportToggle, airportLink);
            airportToggle.append(airportLink, airportButton);
            cdgParisItem.append(cdgParisLink);
            orlyParisItem.append(orlyParisLink);
            beauvaisParisItem.append(beauvaisParisLink);
            airportMenu.append(cdgParisItem, orlyParisItem, beauvaisParisItem);
            airportItem.append(airportMenu);
        }
    }

    if (mobileMenuBtn && navLinks) {
        if (!navLinks.id) navLinks.id = 'navLinks';
        mobileMenuBtn.setAttribute('aria-controls', navLinks.id);
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.setAttribute('aria-label', 'Open navigation menu');

        function closeNavigationDropdowns() {
            navLinks.querySelectorAll('.nav-dropdown.open').forEach(function(dropdown) {
                dropdown.classList.remove('open');
                const button = dropdown.querySelector('.nav-dropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            });
            navLinks.querySelectorAll('.nav-subdropdown.open').forEach(function(subdropdown) {
                subdropdown.classList.remove('open');
                const button = subdropdown.querySelector('.nav-subdropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            });
        }

        function setMobileMenu(open, returnFocus = false) {
            navLinks.classList.toggle('active', open);
            mobileMenuBtn.textContent = open ? '✕' : '☰';
            mobileMenuBtn.setAttribute('aria-expanded', String(open));
            mobileMenuBtn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
            if (!open) closeNavigationDropdowns();
            if (returnFocus) mobileMenuBtn.focus();
        }

        mobileMenuBtn.addEventListener('click', function() {
            setMobileMenu(!navLinks.classList.contains('active'));
        });

        // Close the mobile menu after navigation.
        const menuLinks = navLinks.querySelectorAll('a');
        menuLinks.forEach(link => {
            link.addEventListener('click', function() {
                setMobileMenu(false);
            });
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && navLinks.classList.contains('active')) {
                e.preventDefault();
                setMobileMenu(false, true);
            }
        });
    }

    // Services dropdown in the shared navigation.
    const navDropdowns = document.querySelectorAll('.nav-dropdown');
    navDropdowns.forEach(function(dropdown) {
        const toggleBtn = dropdown.querySelector('.nav-dropdown-btn');
        if (!toggleBtn) return;

        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            const isOpen = dropdown.classList.contains('open');
            navDropdowns.forEach(function(item) {
                item.classList.remove('open');
                const button = item.querySelector('.nav-dropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            });

            document.querySelectorAll('.nav-subdropdown.open').forEach(function(item) {
                item.classList.remove('open');
                const button = item.querySelector('.nav-subdropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            });

            if (!isOpen) {
                dropdown.classList.add('open');
                toggleBtn.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Nested service pages under Airport Transfer, Disneyland and Long Distance.
    const navSubdropdowns = document.querySelectorAll('.nav-subdropdown');
    if (navLinks) {
        navLinks.addEventListener('click', function(e) {
            const toggleBtn = e.target.closest('.nav-subdropdown-btn');
            if (!toggleBtn || !navLinks.contains(toggleBtn)) return;

            e.preventDefault();
            e.stopPropagation();

            const subdropdown = toggleBtn.closest('.nav-subdropdown');
            if (!subdropdown) return;

            const isOpen = subdropdown.classList.contains('open');
            navSubdropdowns.forEach(function(item) {
                item.classList.remove('open');
                const button = item.querySelector('.nav-subdropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            });

            if (!isOpen) {
                subdropdown.classList.add('open');
                toggleBtn.setAttribute('aria-expanded', 'true');
            }
        });
    }

    document.addEventListener('click', function(e) {
        navDropdowns.forEach(function(dropdown) {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
                const button = dropdown.querySelector('.nav-dropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            }
        });

        navSubdropdowns.forEach(function(subdropdown) {
            if (!subdropdown.contains(e.target)) {
                subdropdown.classList.remove('open');
                const button = subdropdown.querySelector('.nav-subdropdown-btn');
                if (button) button.setAttribute('aria-expanded', 'false');
            }
        });
    });

    // Add a compact navbar style after a small scroll offset.
    const navbar = document.getElementById('navbar');

    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Smooth-scroll in-page anchor links while accounting for the fixed navbar.
    const anchorLinks = document.querySelectorAll('a[href^="#"]');

    anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');

            if (href !== '#' && href.length > 1) {
                const targetId = href.substring(1);
                const targetElement = document.getElementById(targetId);

                if (targetElement) {
                    e.preventDefault();
                    const navHeight = navbar.offsetHeight;
                    const targetPosition = targetElement.offsetTop - navHeight;

                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });

    // Prevent selecting a past date when a booking date field is present.
    const dateInput = document.getElementById('date');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.setAttribute('min', today);
    }

    // Legacy calculator support for pages still using the old field set.
    const calcService = document.getElementById('calc-service');
    const calcVehicle = document.getElementById('calc-vehicle');
    const calcOptions = document.querySelectorAll('.calc-option');
    const calcPrice = document.getElementById('calcPrice');

    function updatePrice() {
        if (!calcService || !calcVehicle || !calcPrice) return;

        let total = parseInt(calcService.value) + parseInt(calcVehicle.value);

        calcOptions.forEach(option => {
            if (option.checked) {
                total += parseInt(option.value);
            }
        });

        calcPrice.textContent = total + '€';
    }

    if (calcService) calcService.addEventListener('change', updatePrice);
    if (calcVehicle) calcVehicle.addEventListener('change', updatePrice);
    calcOptions.forEach(option => {
        option.addEventListener('change', updatePrice);
    });



    // Lightweight contact form feedback for static pages.
    const contactForm = document.getElementById('contactForm');
    const contactSuccess = document.getElementById('contactSuccess');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            // Show inline success feedback without leaving the page.
            if (contactSuccess) {
                contactSuccess.classList.add('show');
                contactSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Reset the form after a successful submission.
                contactForm.reset();

                // Auto-hide the success message after a short delay.
                setTimeout(function() {
                    contactSuccess.classList.remove('show');
                }, 5000);
            }

            // Placeholder until the contact form is fully wired to the backend.
            console.log('Contact form submitted');
        });
    }

    // Lazy-load images only when they enter the viewport.
    const lazyImages = document.querySelectorAll('img[data-src]');

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    imageObserver.unobserve(img);
                }
            });
        });

        lazyImages.forEach(function(img) {
            imageObserver.observe(img);
        });
    }

    // Trigger reveal animations only once when elements become visible.
    const animateOnScroll = document.querySelectorAll('.animate-on-scroll');

    if (animateOnScroll.length > 0 && 'IntersectionObserver' in window) {
        const scrollObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                    scrollObserver.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1
        });

        animateOnScroll.forEach(function(element) {
            scrollObserver.observe(element);
        });
    }

});

// ============================================================================
// Shared helpers
// ============================================================================

// Normalize phone input to a French international format when possible.
function formatPhoneNumber(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.startsWith('33')) {
        value = '+' + value;
    } else if (value.startsWith('0')) {
        value = '+33' + value.substring(1);
    }
    return value;
}

// Minimal email format validation for client-side checks.
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Preserve CommonJS compatibility for test or tooling usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatPhoneNumber,
        isValidEmail
    };
}
