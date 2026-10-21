class RidgeCV:
    def __init__(self, alphas=(0.1, 1.0)):
        self.alphas = alphas


class RidgeClassifierCV:
    """Ridge classifier with cross-validation.

    cv_values_ : array, shape = [n_samples, n_alphas] or \
    shape = [n_samples, n_targets, n_alphas], optional
    """

    def __init__(self, alphas=(0.1, 1.0), cv=None):
        self.cv = cv
